import { describe, expect, it } from "vitest";
import { formatHotkeyDisplay } from "./utils/hotkey-formatting";

describe("Anvil application smoke test", () => {
  it("formats the default command palette hotkey for display", () => {
    expect(formatHotkeyDisplay("Command+Space")).toBe("Command+Space");
  });

  it("keeps modifier combinations readable while compacting arrows", () => {
    expect(formatHotkeyDisplay("Command+ArrowRight")).toBe("Command+→");
  });
});
