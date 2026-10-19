/**
 * Secure filesystem helpers for Node-side code (agents, sidecar, tests).
 *
 * - Temporary directories are created with `mkdtemp` (unpredictable name) and
 *   restricted to the current user (0o700).
 * - Atomic writes stage content in an exclusively created (`wx`), owner-only
 *   (0o600) sibling file, then rename it over the target. The final file keeps
 *   its previous permissions (or the process default for new files), so the
 *   visible behavior of callers is unchanged while no partially written or
 *   attacker-pre-created file is ever used.
 * - Read helpers open the file once and use `fstat` on the descriptor instead
 *   of a separate stat/exists check followed by a path-based read.
 *
 * Do not re-export from `@core/lib/index` — that barrel is also bundled for the
 * browser frontend and this module depends on `node:fs`.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export interface AtomicWriteOptions {
  /** Final permission bits. Defaults to the existing file's mode, or 0o666 & ~umask for new files. */
  mode?: number;
}

function isErrnoException(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === code;
}

function defaultNewFileMode(): number {
  return 0o666 & ~process.umask();
}

/** Create a private (0o700) temporary directory with an unpredictable name. */
export function createPrivateTempDir(prefix: string, parent: string = tmpdir()): string {
  const dir = fs.mkdtempSync(join(parent, prefix));
  fs.chmodSync(dir, PRIVATE_DIR_MODE);
  return dir;
}

/** Async variant of {@link createPrivateTempDir}. */
export async function createPrivateTempDirAsync(prefix: string, parent: string = tmpdir()): Promise<string> {
  const dir = await fsp.mkdtemp(join(parent, prefix));
  await fsp.chmod(dir, PRIVATE_DIR_MODE);
  return dir;
}

/** Resolve the file that should actually be replaced (follows a symlink at `path`). */
function resolveWriteTargetSync(path: string): { target: string; mode: number | undefined } {
  let target = path;
  try {
    if (fs.lstatSync(path).isSymbolicLink()) target = fs.realpathSync(path);
  } catch (err) {
    if (!isErrnoException(err, "ENOENT")) throw err;
  }
  try {
    return { target, mode: fs.statSync(target).mode & 0o7777 };
  } catch (err) {
    if (isErrnoException(err, "ENOENT")) return { target, mode: undefined };
    throw err;
  }
}

async function resolveWriteTarget(path: string): Promise<{ target: string; mode: number | undefined }> {
  let target = path;
  try {
    if ((await fsp.lstat(path)).isSymbolicLink()) target = await fsp.realpath(path);
  } catch (err) {
    if (!isErrnoException(err, "ENOENT")) throw err;
  }
  try {
    return { target, mode: (await fsp.stat(target)).mode & 0o7777 };
  } catch (err) {
    if (isErrnoException(err, "ENOENT")) return { target, mode: undefined };
    throw err;
  }
}

function stagingPath(target: string): string {
  return join(dirname(target), `.${basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
}

/**
 * Atomically replace `path` with `data`. Symlinks are preserved (their target is
 * replaced). The staging file is created exclusively with owner-only permissions.
 */
export function writeFileAtomicSync(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  options: AtomicWriteOptions = {},
): void {
  const { target, mode: existingMode } = resolveWriteTargetSync(path);
  const finalMode = options.mode ?? existingMode ?? defaultNewFileMode();
  const tmp = stagingPath(target);
  const fd = fs.openSync(tmp, "wx", PRIVATE_FILE_MODE);
  let renamed = false;
  try {
    try {
      fs.writeFileSync(fd, data);
      fs.fchmodSync(fd, finalMode);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Best effort cleanup; the original error is more useful.
      }
    }
  }
}

/** Async variant of {@link writeFileAtomicSync}. */
export async function writeFileAtomic(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const { target, mode: existingMode } = await resolveWriteTarget(path);
  const finalMode = options.mode ?? existingMode ?? defaultNewFileMode();
  const tmp = stagingPath(target);
  const handle = await fsp.open(tmp, "wx", PRIVATE_FILE_MODE);
  let renamed = false;
  try {
    try {
      await handle.writeFile(data);
      await handle.chmod(finalMode);
    } finally {
      await handle.close();
    }
    await fsp.rename(tmp, target);
    renamed = true;
  } finally {
    if (!renamed) await fsp.unlink(tmp).catch(() => undefined);
  }
}

/**
 * Create `path` only if it does not exist (O_CREAT | O_EXCL). Returns false when
 * the file already exists. Replaces racy `if (!existsSync(p)) writeFileSync(p)`.
 */
export function writeFileExclusiveSync(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  mode: number = defaultNewFileMode(),
): boolean {
  let fd: number;
  try {
    fd = fs.openSync(path, "wx", mode);
  } catch (err) {
    if (isErrnoException(err, "EEXIST")) return false;
    throw err;
  }
  try {
    fs.writeFileSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

/** Read a UTF-8 file through a single descriptor. Returns null if it does not exist. */
export function readFileIfExistsSync(path: string): string | null {
  const result = readFileWithStatSync(path);
  return result === null ? null : result.content;
}

/** Read a UTF-8 file and its stats from the same descriptor. Returns null if it does not exist. */
export function readFileWithStatSync(path: string): { content: string; stat: fs.Stats } | null {
  let fd: number;
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  } catch (err) {
    if (isErrnoException(err, "ENOENT")) return null;
    throw err;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw Object.assign(new Error("Expected a regular file"), { code: "EINVAL" });
    return { content: fs.readFileSync(fd, "utf-8"), stat };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Async: open `path` once, `fstat` the descriptor, and read it only if it is a
 * regular file. Returns null when the path does not exist; `content` is null for
 * non-regular files (directories, FIFOs, devices). The descriptor is opened
 * non-blocking so a FIFO cannot stall the caller.
 */
export async function readFileWithStat(
  path: string,
): Promise<{ content: Buffer | null; stat: fs.Stats } | null> {
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(path, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  } catch (err) {
    if (isErrnoException(err, "ENOENT")) return null;
    throw err;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { content: null, stat };
    return { content: await handle.readFile(), stat };
  } finally {
    await handle.close();
  }
}
