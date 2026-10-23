import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchMisc } from "../dispatch/dispatch-misc.js";
import type { SidecarState } from "../state.js";

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "anvil-shell-"));
  dirs.push(dir);
  return { dir, state: { shellInitialized: false, shellPath: "" } as SidecarState };
}

describe.skipIf(process.platform === "win32")("shell environment initialization", () => {
  it("treats shell metacharacters as a filename without executing them", async () => {
    const { dir, state } = fixture();
    const marker = join(dir, "injected");
    vi.stubEnv("SHELL", "/bin/echo; /usr/bin/touch " + marker + " #");
    expect(await dispatchMisc("initialize_shell_environment", {}, state)).toBe(false);
    expect(existsSync(marker)).toBe(false);
    expect(state.shellInitialized).toBe(true);
    expect(state.shellPath).toBe("");
  });

  it("supports shell paths with spaces and passes login arguments literally", async () => {
    const { dir, state } = fixture();
    const shell = join(dir, "shell with spaces");
    writeFileSync(shell, '#!/bin/sh\n[ "$1" = "-i" ] && [ "$2" = "-l" ] && [ "$3" = "-c" ] || exit 2\nprintf "%s" "/safe/bin:/another/bin"\n', { mode: 0o700 });
    vi.stubEnv("SHELL", shell);
    vi.stubEnv("PATH", process.env.PATH ?? "");
    expect(await dispatchMisc("initialize_shell_environment", {}, state)).toBe(true);
    expect(state.shellPath).toBe("/safe/bin:/another/bin");
    expect(process.env.PATH).toBe(state.shellPath);
    expect(state.shellInitialized).toBe(true);
  });

  it("fails closed on an absent shell and preserves the existing PATH", async () => {
    const { dir, state } = fixture();
    const before = process.env.PATH;
    vi.stubEnv("SHELL", join(dir, "absent"));
    expect(await dispatchMisc("initialize_shell_environment", {}, state)).toBe(false);
    expect(process.env.PATH).toBe(before);
    expect(state.shellInitialized).toBe(true);
  });
});
