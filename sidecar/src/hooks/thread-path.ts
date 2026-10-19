import { mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export function isThreadId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value);
}

function requireContained(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Thread path escapes data directory");
  }
}

export function threadFilePath(dataDir: string, threadId: string, filename: "state.json" | "metadata.json" | "events.jsonl"): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(threadId)) throw new Error("Invalid thread ID");
  const root = resolve(dataDir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const realRoot = realpathSync(root);
  const threads = join(realRoot, "threads");
  mkdirSync(threads, { recursive: true, mode: 0o700 });
  requireContained(realRoot, realpathSync(threads));
  const dir = resolve(threads, threadId);
  if (!dir.startsWith(`${threads}${sep}`)) throw new Error("Thread path escapes data directory");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  requireContained(realpathSync(threads), realpathSync(dir));
  const path = resolve(dir, filename);
  if (!path.startsWith(`${dir}${sep}`)) throw new Error("Thread path escapes data directory");
  try {
    requireContained(realpathSync(dir), realpathSync(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return path;
}
