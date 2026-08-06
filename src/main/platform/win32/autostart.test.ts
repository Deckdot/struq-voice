import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSTART_HIDDEN_ARG,
  createAutostart,
  isAutostartLaunch
} from "./autostart";

const { setLoginItemSettings } = vi.hoisted(() => ({
  setLoginItemSettings: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    setLoginItemSettings
  }
}));

beforeEach(() => {
  setLoginItemSettings.mockClear();
});

describe("Windows autostart", () => {
  it.each([true, false])(
    "registers the hidden marker when enabled is %s",
    (enabled) => {
      createAutostart().setEnabled(enabled);

      expect(setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: enabled,
        args: [AUTOSTART_HIDDEN_ARG]
      });
    }
  );

  it("only identifies launches carrying the autostart marker", () => {
    expect(isAutostartLaunch(["Struq Voice.exe"])).toBe(false);
    expect(
      isAutostartLaunch(["Struq Voice.exe", AUTOSTART_HIDDEN_ARG])
    ).toBe(true);
  });
});
