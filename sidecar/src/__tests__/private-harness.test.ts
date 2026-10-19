import { expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SidecarTestHarness } from "../testing/sidecar-test-harness.js";

it("keeps separate private sidecar fixtures through startup and teardown", async () => {
  const first = new SidecarTestHarness();
  const second = new SidecarTestHarness();
  try {
    expect(first.dataDir).not.toBe(second.dataDir);
    if (process.platform !== "win32") {
      expect(statSync(first.dataDir).mode & 0o777).toBe(0o700);
      expect(statSync(second.dataDir).mode & 0o777).toBe(0o700);
    }
    await Promise.all([first.start(), second.start()]);
    const secondConfig = join(second.hooksDir, "hooks.json");
    expect(JSON.parse(readFileSync(secondConfig, "utf8")).hooks).toBeTruthy();
    await first.teardown();
    expect(existsSync(first.dataDir)).toBe(false);
    expect(existsSync(secondConfig)).toBe(true);
  } finally {
    await first.teardown();
    await second.teardown();
  }
});
