import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TestRepository } from "../services/test-repository.js";
import { TestAnvilDirectory } from "../services/test-anvil-directory.js";
import { AnvilFixture } from "../../../../core/sdk/__tests__/harness/anvil-fixture.js";

function expectPrivate(path: string): void {
  if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o700);
}

describe("private test fixtures", () => {
  it("cleans up allocated roots even before initialization", () => {
    for (const fixture of [new TestRepository(), new TestAnvilDirectory()]) {
      expect(existsSync(fixture.path)).toBe(true);
      expectPrivate(fixture.path);
      fixture.cleanup();
      expect(existsSync(fixture.path)).toBe(false);
      expect(() => fixture.cleanup()).not.toThrow();
    }
  });

  it("isolates same-named repositories and their cleanup", () => {
    const first = new TestRepository({ name: "same-name" });
    const second = new TestRepository({ name: "same-name" });
    try {
      first.init();
      second.init();
      expect(first.name).toBe(second.name);
      expect(first.path).not.toBe(second.path);
      expectPrivate(first.path);
      expectPrivate(second.path);
      first.addFile("only-first.txt", "first");
      second.addFile("only-second.txt", "second");
      expect(existsSync(join(second.path, "only-first.txt"))).toBe(false);
      first.cleanup();
      expect(readFileSync(join(second.path, "only-second.txt"), "utf8")).toBe("second");
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });

  it("creates separate private agent state directories", () => {
    const first = new TestAnvilDirectory();
    const second = new TestAnvilDirectory();
    try {
      first.init();
      second.init();
      expect(first.path).not.toBe(second.path);
      expectPrivate(first.path);
      expectPrivate(second.path);
      expect(JSON.parse(readFileSync(join(first.path, "config.json"), "utf8"))).toEqual({ version: 1 });
      first.cleanup();
      expect(existsSync(join(second.path, "config.json"))).toBe(true);
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });

  it("isolates SDK fixture state and teardown", async () => {
    const first = new AnvilFixture();
    const second = new AnvilFixture();
    try {
      await Promise.all([first.init(), second.init()]);
      expect(first.anvilDir).not.toBe(second.anvilDir);
      expectPrivate(first.anvilDir);
      expectPrivate(second.anvilDir);
      await first.addThread("shared-id", { repoId: "first" });
      await second.addThread("shared-id", { repoId: "second" });
      expect((await first.getThread("shared-id"))?.repoId).toBe("first");
      await first.cleanup();
      expect((await second.getThread("shared-id"))?.repoId).toBe("second");
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });
});
