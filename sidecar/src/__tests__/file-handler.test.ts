import express from "express";
import { rateLimit } from "express-rate-limit";
import { createServer, get, type Server } from "node:http";
import { mkdtemp, writeFile, rm, symlink, open } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createFileHandler } from "../file-handler.js";

let dir: string;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "anvil-file-handler-"));
});

afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

async function start(options: { maxConcurrent?: number; requestsPerMinute?: number; timeoutMs?: number } = {}) {
  const app = express();
  app.use((req, res, next) => {
    if (req.headers.authorization !== "Bearer test-token") {
      res.status(401).end();
      return;
    }
    next();
  });
  app.get("/files", rateLimit({
    windowMs: 60_000,
    limit: options.requestsPerMinute ?? 120,
    keyGenerator: () => "sidecar-files",
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }), createFileHandler(options));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  base = `http://127.0.0.1:${address.port}/files`;
}

function read(path: string) {
  return fetch(`${base}?path=${encodeURIComponent(path)}`, {
    headers: { authorization: "Bearer test-token" },
  });
}

test("serves authorized regular files and symlinks without caching", async () => {
  const path = join(dir, "file.txt");
  await writeFile(path, "hello");
  await symlink(path, join(dir, "link.txt"));
  await start();
  expect((await fetch(`${base}?path=${encodeURIComponent(path)}`)).status).toBe(401);
  for (const name of [path, join(dir, "link.txt")]) {
    const result = await read(name);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toContain("text/plain");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.text()).toBe("hello");
  }
});

test("rejects directories, missing paths, and invalid path input", async () => {
  await start();
  expect((await read(dir)).status).toBe(404);
  expect((await read(join(dir, "missing"))).status).toBe(404);
  expect((await read("bad\0path")).status).toBe(400);
  expect((await read("")).status).toBe(400);
});

test("returns empty files and preserves multi-megabyte binary files", async () => {
  const payload = Buffer.alloc(5 * 1024 * 1024, 173);
  await writeFile(join(dir, "binary.bin"), payload);
  await writeFile(join(dir, "empty"), "");
  await start();
  expect(await (await read(join(dir, "empty"))).text()).toBe("");
  const result = await read(join(dir, "binary.bin"));
  expect(Buffer.from(await result.arrayBuffer()).equals(payload)).toBe(true);
});

test("enforces a shared request budget even when paths change", async () => {
  await start({ requestsPerMinute: 2 });
  await read(join(dir, "one"));
  await read(join(dir, "two"));
  const result = await read(join(dir, "three"));
  expect(result.status).toBe(429);
  expect(result.headers.get("retry-after")).toBe("60");
});

test.skipIf(process.platform === "win32")("rejects FIFOs without waiting for a writer", async () => {
  const path = join(dir, "pipe");
  execFileSync("mkfifo", [path]);
  await start();
  expect((await read(path)).status).toBe(404);
  expect((await read(dir)).status).toBe(404);
});


test("releases concurrency after clients disconnect", async () => {
  const path = join(dir, "large.bin");
  const handle = await open(path, "w");
  await handle.truncate(128 * 1024 * 1024);
  await handle.close();
  await start({ maxConcurrent: 1 });
  const response = await new Promise<import("node:http").IncomingMessage>((resolve) => {
    get(`${base}?path=${encodeURIComponent(path)}`, {
      headers: { authorization: "Bearer test-token" },
    }, resolve);
  });
  expect((await read(path)).status).toBe(429);
  response.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const result = await read(dir);
  expect(result.status).toBe(404);
});


test("expires stalled streams and releases their concurrency slot", async () => {
  const path = join(dir, "stalled.bin");
  const handle = await open(path, "w");
  await handle.truncate(128 * 1024 * 1024);
  await handle.close();
  await start({ maxConcurrent: 1, timeoutMs: 100 });
  const response = await new Promise<import("node:http").IncomingMessage>((resolve) => {
    get(`${base}?path=${encodeURIComponent(path)}`, {
      headers: { authorization: "Bearer test-token" },
    }, resolve);
  });
  expect((await read(path)).status).toBe(429);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect((await read(dir)).status).toBe(404);
  response.destroy();
});
