import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isThreadId, threadFilePath } from "../hooks/thread-path.js";
import { EventWriter } from "../hooks/event-writer.js";
import { ThreadStateWriter } from "../hooks/thread-state-writer.js";
import { EventBroadcaster } from "../push.js";

let dir: string;
const log = { info() {}, warn() {}, error() {} };
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "anvil-thread-boundary-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("thread filesystem boundary", () => {
  it.each(["../outside", "a/b", "a\\b", "..", ".", "", "id\0x", "/root", "C:\\root"])("rejects unsafe component %s", (id) => {
    expect(isThreadId(id)).toBe(false);
    expect(() => threadFilePath(dir, id, "state.json")).toThrow("Invalid thread ID");
  });

  it("accepts normal UUID and named identifiers", () => {
    expect(isThreadId("d65dd787-6e3e-44d1-8879-9f0b9850e6da")).toBe(true);
    expect(isThreadId("thread_1.v2")).toBe(true);
  });

  it("rejects directory symlinks escaping the data root", () => {
    const data = join(dir, "data");
    const outside = join(dir, "outside");
    mkdirSync(join(data, "threads"), { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(data, "threads", "escape"));
    expect(() => threadFilePath(data, "escape", "state.json")).toThrow("escapes");
  });

  it("does not overwrite or append to escaping file symlinks", async () => {
    const data = join(dir, "data");
    const threadDir = join(data, "threads", "thread-1");
    mkdirSync(threadDir, { recursive: true });
    const target = join(dir, "outside.json");
    writeFileSync(target, "unchanged");
    symlinkSync(target, join(threadDir, "state.json"));
    symlinkSync(target, join(threadDir, "events.jsonl"));
    const writer = new ThreadStateWriter(data, new EventBroadcaster(), log);
    expect(writer.getState("thread-1")).toBeUndefined();
    await writer.dispatch("thread-1", { type: "INIT", payload: { workingDirectory: dir } });
    new EventWriter(data, log).sessionStarted("thread-1", dir);
    expect(readFileSync(target, "utf8")).toBe("unchanged");
  });

  it("does not create external targets through dangling file symlinks", async () => {
    const data = join(dir, "data");
    const threadDir = join(data, "threads", "thread-1");
    mkdirSync(threadDir, { recursive: true });
    const target = join(dir, "missing.json");
    symlinkSync(target, join(threadDir, "state.json"));
    symlinkSync(target, join(threadDir, "events.jsonl"));
    await new ThreadStateWriter(data, new EventBroadcaster(), log).dispatch("thread-1", {
      type: "INIT", payload: { workingDirectory: dir },
    });
    new EventWriter(data, log).sessionStarted("thread-1", dir);
    expect(existsSync(target)).toBe(false);
  });

  it("persists valid state and events privately", async () => {
    const writer = new ThreadStateWriter(dir, new EventBroadcaster(), log);
    await writer.dispatch("thread-1", { type: "INIT", payload: { workingDirectory: dir } });
    new EventWriter(dir, log).sessionStarted("thread-1", dir);
    const fresh = new ThreadStateWriter(dir, new EventBroadcaster(), log);
    expect(fresh.getState("thread-1")?.workingDirectory).toBe(dir);
    expect(JSON.parse(readFileSync(join(dir, "threads/thread-1/events.jsonl"), "utf8")).type).toBe("SESSION_STARTED");
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "threads/thread-1/state.json")).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "threads/thread-1/events.jsonl")).mode & 0o777).toBe(0o600);
    }
  });
});
