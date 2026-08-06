import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { insertTextIntoActiveApp, type PasteDeps, type PasteOptions } from "./paste";

const OPTIONS: PasteOptions = {
  restoreClipboard: true,
  restoreClipboardDelayMs: 400,
};

interface Fakes {
  deps: PasteDeps;
  getFocusedWindow: ReturnType<typeof vi.fn<() => BrowserWindow | null>>;
  readText: ReturnType<typeof vi.fn<() => string>>;
  writeText: ReturnType<typeof vi.fn<(text: string) => void>>;
  keyTap: ReturnType<typeof vi.fn<() => void>>;
  keyTapEnter: ReturnType<typeof vi.fn<() => void>>;
  execPowershell: ReturnType<typeof vi.fn<() => Promise<void>>>;
  execPowershellEnter: ReturnType<typeof vi.fn<() => Promise<void>>>;
  delay: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;
}

interface FakesOverrides {
  stash?: string;
  focused?: boolean;
  keyTapError?: Error;
  powershellError?: Error;
}

const makeFakes = (overrides: FakesOverrides = {}): Fakes => {
  const stash = overrides.stash ?? "old clipboard";
  const getFocusedWindow = vi.fn<() => BrowserWindow | null>(() =>
    overrides.focused === true ? ({} as BrowserWindow) : null,
  );
  const readText = vi.fn<() => string>(() => stash);
  const writeText = vi.fn<(text: string) => void>();
  const keyTap = vi.fn<() => void>(() => {
    if (overrides.keyTapError !== undefined) throw overrides.keyTapError;
  });
  const keyTapEnter = vi.fn<() => void>();
  const execPowershell = vi.fn<() => Promise<void>>(() => {
    if (overrides.powershellError !== undefined) {
      return Promise.reject(overrides.powershellError);
    }
    return Promise.resolve();
  });
  const execPowershellEnter = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const delay = vi.fn<(ms: number) => Promise<void>>(
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  return {
    deps: {
      getFocusedWindow,
      clipboard: { readText, writeText },
      keyTap,
      keyTapEnter,
      execPowershell,
      execPowershellEnter,
      delay,
    },
    getFocusedWindow,
    readText,
    writeText,
    keyTap,
    keyTapEnter,
    execPowershell,
    execPowershellEnter,
    delay,
  };
};

describe("paste delivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports inserted false and touches nothing when our window is focused", async () => {
    const f = makeFakes({ focused: true });
    const result = await insertTextIntoActiveApp("transcript", OPTIONS, f.deps);

    expect(result).toEqual({ ok: true, value: { inserted: false } });
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.writeText).not.toHaveBeenCalled();
    expect(f.keyTap).not.toHaveBeenCalled();
    expect(f.execPowershell).not.toHaveBeenCalled();
  });

  it("stashes, pastes, then restores the clipboard after the delay", async () => {
    const f = makeFakes({ stash: "old text" });
    const promise = insertTextIntoActiveApp("transcript", OPTIONS, f.deps);

    expect(f.readText).toHaveBeenCalledTimes(1);
    expect(f.writeText).toHaveBeenNthCalledWith(1, "transcript");
    expect(f.keyTap).toHaveBeenCalledTimes(1);
    expect(f.writeText).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(OPTIONS.restoreClipboardDelayMs);
    const result = await promise;

    expect(f.delay).toHaveBeenCalledWith(OPTIONS.restoreClipboardDelayMs);
    expect(f.writeText).toHaveBeenNthCalledWith(2, "old text");
    expect(result).toEqual({ ok: true, value: { inserted: true } });
  });

  it("does not restore the clipboard when disabled", async () => {
    const f = makeFakes({ stash: "old text" });
    const options: PasteOptions = {
      restoreClipboard: false,
      restoreClipboardDelayMs: 400,
    };
    const result = await insertTextIntoActiveApp("transcript", options, f.deps);

    expect(result).toEqual({ ok: true, value: { inserted: true } });
    expect(f.writeText).toHaveBeenCalledTimes(1);
    expect(f.writeText).toHaveBeenCalledWith("transcript");
    expect(f.delay).not.toHaveBeenCalled();
  });

  it("falls back to powershell when keyTap throws", async () => {
    const f = makeFakes({ keyTapError: new Error("hook not running") });
    const result = await insertTextIntoActiveApp(
      "transcript",
      {
        ...OPTIONS,
        restoreClipboard: false,
      },
      f.deps,
    );

    expect(f.keyTap).toHaveBeenCalledTimes(1);
    expect(f.execPowershell).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, value: { inserted: true } });
  });

  it("reports inserted false, without throwing, when both paste paths fail", async () => {
    const f = makeFakes({
      keyTapError: new Error("hook not running"),
      powershellError: new Error("powershell rejected"),
    });
    const result = await insertTextIntoActiveApp("transcript", OPTIONS, f.deps);

    expect(f.execPowershell).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, value: { inserted: false } });
  });

  it("skips the restore when there was nothing stashed", async () => {
    const f = makeFakes({ stash: "" });
    const result = await insertTextIntoActiveApp("transcript", OPTIONS, f.deps);

    expect(result).toEqual({ ok: true, value: { inserted: true } });
    expect(f.writeText).toHaveBeenCalledTimes(1);
    expect(f.writeText).toHaveBeenCalledWith("transcript");
    expect(f.delay).not.toHaveBeenCalled();
  });

  it("synthesizes enter key when pressEnterAfterPaste is enabled", async () => {
    const f = makeFakes({ stash: "" });
    const promise = insertTextIntoActiveApp("transcript", { ...OPTIONS, pressEnterAfterPaste: true }, f.deps);

    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toEqual({ ok: true, value: { inserted: true } });
    expect(f.keyTapEnter).toHaveBeenCalledTimes(1);
  });
});
