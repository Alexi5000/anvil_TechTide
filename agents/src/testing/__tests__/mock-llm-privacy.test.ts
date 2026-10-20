import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createMockScript, cleanupMockScript } from "../mock-llm.js";
import { createPrivateTempDir } from "../../../../core/lib/secure-fs.js";

describe("private mock scripts", () => {
  it("isolates scripts with private permissions and independent cleanup", () => {
    const script = { responses: [{ content: "private synthetic prompt" }] };
    const first = createMockScript(script);
    const second = createMockScript(script);
    try {
      expect(dirname(first)).not.toBe(dirname(second));
      expect(JSON.parse(readFileSync(first, "utf8"))).toEqual(script);
      if (process.platform !== "win32") {
        expect(statSync(first).mode & 0o777).toBe(0o600);
        expect(statSync(dirname(first)).mode & 0o777).toBe(0o700);
      }
      cleanupMockScript(first);
      expect(existsSync(dirname(first))).toBe(false);
      expect(JSON.parse(readFileSync(second, "utf8"))).toEqual(script);
      expect(() => cleanupMockScript(first)).not.toThrow();
    } finally {
      cleanupMockScript(first);
      cleanupMockScript(second);
    }
  });

  it("removes its empty directory when the script was already removed", () => {
    const path = createMockScript({ responses: [] });
    unlinkSync(path);
    cleanupMockScript(path);
    expect(existsSync(dirname(path))).toBe(false);
  });

  it("does not recursively remove unrelated files during cleanup", () => {
    const path = createMockScript({ responses: [] });
    const other = join(dirname(path), "other.json");
    try {
      writeFileSync(other, "preserve", { flag: "wx", mode: 0o600 });
      cleanupMockScript(path);
      expect(readFileSync(other, "utf8")).toBe("preserve");
      unlinkSync(other);
      cleanupMockScript(path);
      expect(existsSync(dirname(path))).toBe(false);
    } finally {
      if (existsSync(other)) unlinkSync(other);
      cleanupMockScript(path);
    }
  });

  it("keeps the parent directory of caller-supplied legacy scripts", () => {
    const directory = createPrivateTempDir("legacy-mock-script-");
    const path = join(directory, "legacy.json");
    try {
      writeFileSync(path, "{}", { flag: "wx", mode: 0o600 });
      cleanupMockScript(path);
      expect(existsSync(path)).toBe(false);
      expect(existsSync(directory)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
