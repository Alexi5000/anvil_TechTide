import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SimpleRunnerStrategy } from "./simple-runner-strategy.js";
import { generateThreadName } from "../services/thread-naming-service.js";
import type { RunnerConfig } from "./types.js";

const failures = vi.hoisted(() => ({ write: false }));
async function mockedFs() {
  const actual = await vi.importActual<typeof fs>("node:fs");
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (failures.write) {
        actual.writeFileSync(args[0], '{"partial":');
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      }
      return actual.writeFileSync(...args);
    },
  };
};
vi.mock("node:fs", () => mockedFs());
vi.mock("fs", () => mockedFs());
vi.mock("./shared.js", () => ({ emitEvent: vi.fn(), emitLog: vi.fn() }));
vi.mock("../services/thread-naming-service.js", () => ({
  generateThreadName: vi.fn(() => new Promise(() => {})),
}));
vi.mock("child_process", () => ({ execFileSync: vi.fn(() => { throw new Error("not a repository"); }) }));

let root: string;
let config: RunnerConfig;
let strategy: SimpleRunnerStrategy;
let metadata: string;
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "anvil-runner-storage-"));
  config = {
    repoId: "11111111-1111-4111-8111-111111111111", worktreeId: "22222222-2222-4222-8222-222222222222", threadId: "33333333-3333-4333-8333-333333333333", anvilDir: root,
    cwd: root, prompt: "first", skipNaming: true,
  } as RunnerConfig;
  strategy = new SimpleRunnerStrategy();
  metadata = join(root, "threads", config.threadId, "metadata.json");
  failures.write = false;
  vi.mocked(generateThreadName).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  failures.write = false;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("runner durable state", () => {
  it("preserves metadata when asynchronous naming encounters a partial write", async () => {
    let resolveName!: (value: { name: string; usedFallback: boolean }) => void;
    vi.mocked(generateThreadName).mockImplementation(() => new Promise(resolve => { resolveName = resolve; }));
    await strategy.setup(config);
    const before = fs.readFileSync(metadata, "utf8");
    failures.write = true;
    resolveName({ name: "new name", usedFallback: false });
    await new Promise(resolve => setImmediate(resolve));
    expect(fs.readFileSync(metadata, "utf8")).toBe(before);
    expect(fs.readdirSync(join(root, "threads", config.threadId))).toEqual(["metadata.json"]);
  });

  it("preserves repository settings when a worktree rename write fails", () => {
    const dir = join(root, "repositories", "repo");
    fs.mkdirSync(dir, { recursive: true });
    const path = join(dir, "settings.json");
    const before = JSON.stringify({
      id: config.repoId, schemaVersion: 1, name: "repo", originalUrl: null,
      sourcePath: root, useWorktrees: true, createdAt: 1, lastUpdated: 1,
      threadBranches: {}, worktrees: [{ id: config.worktreeId, name: "old", path: root }],
    });
    fs.writeFileSync(path, before);
    failures.write = true;
    const writer = strategy as unknown as {
      updateWorktreeNameOnDisk(dir: string, repo: string, worktree: string, name: string): void;
    };
    expect(() => writer.updateWorktreeNameOnDisk(root, config.repoId!, config.worktreeId!, "new")).toThrow("disk full");
    expect(fs.readFileSync(path, "utf8")).toBe(before);
    expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("preserves the previous metadata after a partial resume write fails", async () => {
    await strategy.setup(config);
    const before = fs.readFileSync(metadata, "utf8");
    failures.write = true;
    await expect(strategy.setup({ ...config, historyFile: "history", prompt: "second" })).rejects.toThrow();
    expect(fs.readFileSync(metadata, "utf8")).toBe(before);
    expect(fs.readdirSync(join(root, "threads", config.threadId))).toEqual(["metadata.json"]);
  });

  it("never publishes a partial new metadata file when storage fails", async () => {
    failures.write = true;
    await expect(strategy.setup(config)).rejects.toThrow("disk full");
    expect(fs.existsSync(metadata)).toBe(false);
    expect(fs.readdirSync(join(root, "threads", config.threadId))).toEqual([]);
  });

  it("preserves metadata after a partial cleanup write fails", async () => {
    const context = await strategy.setup(config);
    const before = fs.readFileSync(metadata, "utf8");
    failures.write = true;
    await strategy.cleanup(context, "completed");
    expect(fs.readFileSync(metadata, "utf8")).toBe(before);
    expect(fs.readdirSync(context.threadPath)).toEqual(["metadata.json"]);
  });

  it("retains symlinks, permissions, turns and final usage through resume and cleanup", async () => {
    await strategy.setup(config);
    const target = join(root, "metadata-target.json");
    fs.renameSync(metadata, target);
    fs.chmodSync(target, 0o640);
    fs.symlinkSync(target, metadata);
    const context = await strategy.setup({ ...config, historyFile: "history", prompt: "second", permissionMode: "plan" });
    const usage = { inputTokens: 7, outputTokens: 3 };
    fs.writeFileSync(join(context.threadPath, "state.json"), JSON.stringify({ cumulativeUsage: usage }));
    await strategy.cleanup(context, "completed");
    const saved = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(fs.lstatSync(metadata).isSymbolicLink()).toBe(true);
    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
    expect(saved.turns.map((turn: { prompt: string }) => turn.prompt)).toEqual(["first", "second"]);
    expect(saved.turns[1].completedAt).toEqual(expect.any(Number));
    expect(saved.permissionMode).toBe("plan");
    expect(saved.status).toBe("completed");
    expect(saved.pid).toBe(null);
    expect(saved.cumulativeUsage).toEqual(usage);
  });
});
