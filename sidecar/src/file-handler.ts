import type { RequestHandler } from "express";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { resolve, extname, dirname, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { lookup } from "mime-types";

export function createFileHandler(options: {
  maxConcurrent?: number;
  timeoutMs?: number;
  roots?: string[];
  files?: string[];
} = {}): RequestHandler {
  const maxConcurrent = options.maxConcurrent ?? 4;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const roots = (options.roots ?? []).map((path) => resolve(path));
  const files = new Set((options.files ?? []).map((path) => resolve(path)));
  const isAllowed = (path: string) => files.has(path) || roots.some((root) =>
    path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`));
  let active = 0;

  return async (req, res) => {
    if (active >= maxConcurrent) {
      res.setHeader("Retry-After", "60");
      res.status(429).send("File request limit reached");
      return;
    }
    const filePath = req.query.path;
    if (typeof filePath !== "string" || !filePath || filePath.includes("\0")) {
      res.status(400).send("Missing or invalid 'path' query parameter");
      return;
    }
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    const onClose = () => controller.abort();
    res.once("close", onClose);
    let handle;
    try {
      const resolved = resolve(filePath);
      const selected = [...files].find((file) => file === resolved);
      const root = selected ? dirname(selected) : roots.find((root) =>
        resolved === root || resolved.startsWith(root.endsWith(sep) ? root : `${root}${sep}`));
      if (root === undefined) {
        res.status(403).send("File is outside configured workspaces and selected files");
        return;
      }
      if (resolved === root) {
        res.status(404).send("Not a file");
        return;
      }
      const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
      if (!resolved.startsWith(prefix)) {
        res.status(403).send("File is outside configured workspaces and selected files");
        return;
      }
      const canonical = await realpath(resolved);
      if (!isAllowed(canonical)) {
        res.status(403).send("File is outside configured workspaces and selected files");
        return;
      }
      handle = await open(canonical, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      const openedPath = process.platform === "linux"
        ? await realpath(`/proc/self/fd/${handle.fd}`)
        : await realpath(canonical);
      const current = await stat(openedPath);
      if (!isAllowed(openedPath) || openedPath !== canonical ||
          info.dev !== current.dev || info.ino !== current.ino || !info.isFile()) {
        res.status(404).send("Not a file");
        return;
      }
      res.setHeader("Content-Type", lookup(extname(resolved)) || "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Length", info.size);
      if (info.size === 0) {
        res.end();
        return;
      }
      await pipeline(handle.createReadStream({ autoClose: false, end: info.size - 1 }), res, {
        signal: controller.signal,
      });
    } catch {
      if (!res.headersSent && !res.destroyed) res.status(404).send("File not found");
      else if (!res.destroyed) res.destroy();
    } finally {
      clearTimeout(timer);
      res.off("close", onClose);
      await handle?.close().catch(() => undefined);
      active--;
    }
  };
}
