import type { RequestHandler } from "express";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { lookup } from "mime-types";

export function createFileHandler(options: {
  maxConcurrent?: number;
  requestsPerMinute?: number;
  timeoutMs?: number;
} = {}): RequestHandler {
  const maxConcurrent = options.maxConcurrent ?? 4;
  const requestsPerMinute = options.requestsPerMinute ?? 120;
  const timeoutMs = options.timeoutMs ?? 60_000;
  let active = 0;
  let windowStart = Date.now();
  let requests = 0;

  return async (req, res) => {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      requests = 0;
    }
    if (active >= maxConcurrent || requests >= requestsPerMinute) {
      res.setHeader("Retry-After", "60");
      res.status(429).send("File request limit reached");
      return;
    }
    requests++;
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
      handle = await open(resolved, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      const info = await handle.stat();
      if (!info.isFile()) {
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
