import * as fs from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";

export function claudeTranscriptRoot(): string {
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  if (!isAbsolute(config)) throw new Error("CLAUDE_CONFIG_DIR must be absolute");
  return resolve(config, "projects");
}

function contained(root: string, target: string): boolean {
  return target.startsWith(root.endsWith(sep) ? root : root + sep);
}

export function readHookTranscript(root: string, filePath: unknown, sessionId: unknown): string {
  if (typeof filePath !== "string" || !isAbsolute(filePath)
    || typeof sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(sessionId)) {
    throw new Error("Invalid transcript reference");
  }
  const realRoot = fs.realpathSync(root);
  const candidate = resolve(filePath);
  if ((!contained(resolve(root), candidate) && !contained(realRoot, candidate))
    || basename(candidate) !== `${sessionId}.jsonl`) {
    throw new Error("Transcript is outside the session boundary");
  }
  const canonical = fs.realpathSync(candidate);
  if (!contained(realRoot, canonical)) throw new Error("Transcript escapes its configured root");
  const before = fs.lstatSync(candidate);
  if (!before.isFile()) throw new Error("Transcript must be a regular file");
  const fd = fs.openSync(candidate, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    const after = fs.lstatSync(candidate);
    if (!opened.isFile() || !after.isFile()
      || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.dev !== after.dev || opened.ino !== after.ino
      || !contained(realRoot, fs.realpathSync(candidate))) {
      throw new Error("Transcript changed during open");
    }
    if (process.platform === "linux" && !contained(realRoot, fs.realpathSync(`/proc/self/fd/${fd}`))) {
      throw new Error("Opened transcript escapes its configured root");
    }
    return fs.readFileSync(fd, "utf-8");
  } finally {
    fs.closeSync(fd);
  }
}
