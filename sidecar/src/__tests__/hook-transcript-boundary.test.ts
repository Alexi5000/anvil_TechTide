import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHookRouter } from "../hooks/hook-handler.js";
import { EventBroadcaster } from "../push.js";
import { claudeTranscriptRoot, readHookTranscript } from "../hooks/transcript-file.js";

vi.mock("node:fs", async (importOriginal) => ({ ...await importOriginal<typeof import("node:fs")>() }));

const sessionId = "11111111-1111-4111-8111-111111111111";
function line(text: string) {
  return JSON.stringify({ type: "assistant", uuid: text, message: { content: [{ type: "text", text }] } });
}

describe("hook transcript boundary", () => {
  let fixture: string;
  let dataDir: string;
  let root: string;
  let file: string;
  let server: Server;
  let base: string;

  async function post(route: string, body: unknown, thread = "thread-test") {
    const response = await fetch(base + route, {
      method: "POST", headers: { "Content-Type": "application/json", "x-anvil-thread-id": thread },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    await response.json();
  }
  function messages() {
    return JSON.parse(fs.readFileSync(join(dataDir, "threads/thread-test/state.json"), "utf8")).messages;
  }
  beforeEach(async () => {
    fixture = fs.mkdtempSync(join(tmpdir(), "anvil-transcript-boundary-"));
    dataDir = join(fixture, "data");
    const config = join(fixture, "custom-claude-config");
    root = join(config, "projects");
    file = join(root, "-project", `${sessionId}.jsonl`);
    fs.mkdirSync(join(root, "-project"), { recursive: true });
    fs.writeFileSync(file, line("allowed") + "\n");
    vi.stubEnv("CLAUDE_CONFIG_DIR", config);
    const app = express();
    app.use("/hooks", createHookRouter({ dataDir, broadcaster: new EventBroadcaster(), log: { info() {}, warn() {}, error() {} } }));
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no server");
    base = `http://127.0.0.1:${address.port}/hooks`;
    await post("/session-start", { session_id: sessionId, cwd: fixture });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it("uses the configured CLI root and preserves incremental post-tool and stop messages", async () => {
    expect(claudeTranscriptRoot()).toBe(root);
    await post("/post-tool-use", { transcript_path: file, session_id: sessionId });
    fs.appendFileSync(file, line("appended") + "\n");
    await post("/stop", { transcript_path: file, session_id: sessionId });
    expect(messages().map((m: { id: string }) => m.id)).toEqual(["allowed", "appended"]);
  });

  it("rejects outside, traversal, prefix-sibling, relative and nonstring references", async () => {
    const outside = join(fixture, `${sessionId}.jsonl`);
    fs.writeFileSync(outside, line("PRIVATE_CANARY"));
    const sibling = root + "-other";
    fs.mkdirSync(sibling);
    fs.writeFileSync(join(sibling, `${sessionId}.jsonl`), line("PRIVATE_CANARY"));
    for (const target of [outside, `${root}/../../${sessionId}.jsonl`, join(sibling, `${sessionId}.jsonl`), "../private.jsonl", { path: file }]) {
      await post("/post-tool-use", { transcript_path: target, session_id: sessionId });
      await post("/stop", { transcript_path: target, session_id: sessionId });
    }
    expect(messages()).toEqual([]);
  });

  it("rejects another session filename, absent session and mismatched hook session", async () => {
    const other = join(root, "-project", "other-session.jsonl");
    fs.writeFileSync(other, line("OTHER_SESSION"));
    await post("/post-tool-use", { transcript_path: other, session_id: sessionId });
    await post("/post-tool-use", { transcript_path: file });
    await post("/stop", { transcript_path: file, session_id: "other-session" });
    expect(messages()).toEqual([]);
  });

  it("denies final and escaping directory symlinks", async () => {
    const outsideDir = join(fixture, "outside");
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(join(outsideDir, `${sessionId}.jsonl`), line("PRIVATE_CANARY"));
    fs.unlinkSync(file);
    fs.symlinkSync(join(outsideDir, `${sessionId}.jsonl`), file);
    await post("/post-tool-use", { transcript_path: file, session_id: sessionId });
    fs.symlinkSync(outsideDir, join(root, "linked"));
    await post("/stop", { transcript_path: join(root, "linked", `${sessionId}.jsonl`), session_id: sessionId });
    expect(messages()).toEqual([]);
  });

  it("rejects a parent-directory swap between validation and descriptor open", () => {
    const outside = join(fixture, "swap-outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(join(outside, `${sessionId}.jsonl`), line("PRIVATE_CANARY"));
    const originalOpen = fs.openSync;
    const read = vi.spyOn(fs, "readFileSync");
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      if (target === file) {
        fs.renameSync(join(root, "-project"), join(root, "-old-project"));
        fs.symlinkSync(outside, join(root, "-project"));
      }
      return originalOpen(target, flags, mode);
    });
    expect(() => readHookTranscript(root, file, sessionId)).toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects FIFO and directories without hanging", async () => {
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    expect(() => readHookTranscript(root, file, sessionId)).toThrow();
    fs.rmdirSync(file);
    if (process.platform !== "win32") {
      execFileSync("mkfifo", [file]);
      expect(() => readHookTranscript(root, file, sessionId)).toThrow();
    }
  });

  it("uses the default CLI config when unset and rejects ambiguous relative config", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "");
    expect(claudeTranscriptRoot()).toMatch(/[\/]\.claude[\/]projects$/);
    vi.stubEnv("CLAUDE_CONFIG_DIR", "relative-config");
    expect(() => claudeTranscriptRoot()).toThrow("must be absolute");
  });
});
