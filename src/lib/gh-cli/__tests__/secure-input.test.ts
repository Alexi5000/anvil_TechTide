// @vitest-environment node
import { expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ create: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: mocks.create } }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
import { GH_INPUT_BRIDGE, execGhJsonInput } from "../secure-input";

it("passes JSON through stdin with EOF and no secret in process arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gh-stdin-test-"));
  try {
    await writeFile(join(dir, "gh"), '#!/usr/bin/env node\nlet input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({id:1,args:process.argv.slice(2),body:JSON.parse(input)})));', { mode: 0o700 });
    const secret = "synthetic-private-webhook-secret";
    const result = await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, ["-e", GH_INPUT_BRIDGE, JSON.stringify(["api", "repos/a/b/hooks", "--method", "POST"])], { env: { ...process.env, PATH: dir + ":" + process.env.PATH }, timeout: 5000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
      child.stdin!.write(JSON.stringify({ config: { secret } }) + "\n");
    });
    const parsed = JSON.parse(result);
    expect(parsed.args).toEqual(["api", "repos/a/b/hooks", "--method", "POST", "--input", "-"]);
    expect(parsed.body.config.secret).toBe(secret);
    expect(parsed.args.join(" ")).not.toContain(secret);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("never propagates payload or native exception text on failure", async () => {
  const secret = "synthetic-secret-not-for-logs";
  mocks.invoke.mockResolvedValue("/bin");
  mocks.create.mockImplementation(() => { throw new Error(secret); });
  await expect(execGhJsonInput(["api", "repos/a/b/hooks"], "/repo", { secret })).rejects.toThrow("GitHub webhook operation failed");
  expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(secret);
});
