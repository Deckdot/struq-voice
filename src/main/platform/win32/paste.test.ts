import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow, NativeImage } from "electron";
import { insertTextIntoActiveApp, type PasteDeps, type PasteOptions } from "./paste";

const OPTIONS: PasteOptions = {
  automaticPaste: true,
  restoreClipboard: true,
  restoreClipboardDelayMs: 400,
};

interface Fakes {
  deps: PasteDeps;
  getFocusedWindow: ReturnType<typeof vi.fn<() => BrowserWindow | null>>;
  readText: ReturnType<typeof vi.fn<() => string>>;
  writeText: ReturnType<typeof vi.fn<(text: string) => void>>;
  keyTap: ReturnType<typeof vi.fn<() => void>>;
  releaseModifiers: ReturnType<typeof vi.fn<() => void>>;
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

/**
 * `delay` resolves immediately and records what it was asked to wait for. The
 * order of the clipboard writes is what these tests are about, and real
 * timers only obscure it.
 */
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
  const releaseModifiers = vi.fn<() => void>();
  const keyTapEnter = vi.fn<() => void>();
  const execPowershell = vi.fn<() => Promise<void>>(() => {
    if (overrides.powershellError !== undefined) {
      return Promise.reject(overrides.powershellError);
    }
    return Promise.resolve();
  });
  const execPowershellEnter = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const delay = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  return {
    deps: {
      getFocusedWindow,
      clipboard: { readText, writeText },
      keyTap,
      releaseModifiers,
      keyTapEnter,
      execPowershell,
      execPowershellEnter,
      delay,
    },
    getFocusedWindow,
    readText,
    writeText,
    keyTap,
    releaseModifiers,
    keyTapEnter,
    execPowershell,
    execPowershellEnter,
    delay,
  };
};

describe("paste delivery", () => {
  it("touches neither the clipboard nor keyboard when automatic paste is disabled", async () => {
    const f = makeFakes();
    const result = await insertTextIntoActiveApp(
      "transcript",
      { ...OPTIONS, automaticPaste: false },
      f.deps
    );

    expect(result).toEqual({ ok: true, value: { inserted: false } });
    expect(f.getFocusedWindow).not.toHaveBeenCalled();
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.writeText).not.toHaveBeenCalled();
    expect(f.keyTap).not.toHaveBeenCalled();
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
    const result = await insertTextIntoActiveApp("transcript", OPTIONS, f.deps);

    expect(f.readText).toHaveBeenCalledTimes(1);
    expect(f.writeText).toHaveBeenNthCalledWith(1, "transcript");
    expect(f.keyTap).toHaveBeenCalledTimes(1);
    expect(f.delay).toHaveBeenCalledWith(OPTIONS.restoreClipboardDelayMs);
    expect(f.writeText).toHaveBeenNthCalledWith(2, "old text");
    expect(result).toEqual({ ok: true, value: { inserted: true } });
  });

  /**
   * `writeText` returns before the foreground app can read the clipboard
   * back, so pasting in the same tick lands whatever was there before. This
   * is the most common reason a dictation silently did not paste.
   */
  it("lets the clipboard settle before synthesizing the keystroke", async () => {
    const order: string[] = [];
    const f = makeFakes({ stash: "" });
    const deps: PasteDeps = {
      ...f.deps,
      clipboard: {
        readText: () => "",
        writeText: () => {
          order.push("write");
        },
      },
      delay: (ms: number) => {
        order.push(`delay:${String(ms)}`);
        return Promise.resolve();
      },
      keyTap: () => {
        order.push("keyTap");
      },
    };

    await insertTextIntoActiveApp("transcript", OPTIONS, deps);

    expect(order[0]).toBe("write");
    expect(order[1]).toMatch(/^delay:/);
    expect(order[2]).toBe("keyTap");
  });

  /**
   * Push-to-talk ends on the trigger key, usually before the modifier comes
   * up. Ctrl+V on top of a held Shift reaches the target as Ctrl+Shift+V.
   */
  it("releases held modifiers before pasting", async () => {
    const order: string[] = [];
    const f = makeFakes({ stash: "" });
    const deps: PasteDeps = {
      ...f.deps,
      releaseModifiers: () => {
        order.push("release");
      },
      keyTap: () => {
        order.push("keyTap");
      },
    };

    await insertTextIntoActiveApp("transcript", OPTIONS, deps);

    expect(order).toEqual(["release", "keyTap"]);
  });

  it("still pastes when releasing the modifiers throws", async () => {
    const f = makeFakes({ stash: "" });
    const deps: PasteDeps = {
      ...f.deps,
      releaseModifiers: () => {
        throw new Error("hook not running");
      },
    };

    const result = await insertTextIntoActiveApp("transcript", OPTIONS, deps);

    expect(f.keyTap).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, value: { inserted: true } });
  });

  it("does not restore the clipboard when disabled", async () => {
    const f = makeFakes({ stash: "old text" });
    const options: PasteOptions = {
      automaticPaste: true,
      restoreClipboard: false,
      restoreClipboardDelayMs: 400,
    };
    const result = await insertTextIntoActiveApp("transcript", options, f.deps);

    expect(result).toEqual({ ok: true, value: { inserted: true } });
    expect(f.writeText).toHaveBeenCalledTimes(1);
    expect(f.writeText).toHaveBeenCalledWith("transcript");
    expect(f.delay).not.toHaveBeenCalledWith(400);
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

  /**
   * When nothing was delivered the clipboard holds the only copy of what the
   * user said. Restoring over it would take that away too.
   */
  it("leaves the transcript on the clipboard when delivery failed", async () => {
    const f = makeFakes({
      stash: "old text",
      keyTapError: new Error("hook not running"),
      powershellError: new Error("powershell rejected"),
    });

    await insertTextIntoActiveApp("transcript", OPTIONS, f.deps);

    expect(f.writeText).toHaveBeenCalledTimes(1);
    expect(f.writeText).toHaveBeenCalledWith("transcript");
  });

  it("skips the restore when there was nothing stashed", async () => {
    const f = makeFakes({ stash: "" });
    const result = await insertTextIntoActiveApp("transcript", OPTIONS, f.deps);

    expect(result).toEqual({ ok: true, value: { inserted: true } });
    expect(f.writeText).toHaveBeenCalledTimes(1);
    expect(f.writeText).toHaveBeenCalledWith("transcript");
    expect(f.delay).not.toHaveBeenCalledWith(400);
  });

  it("synthesizes enter key when pressEnterAfterPaste is enabled", async () => {
    const f = makeFakes({ stash: "" });
    const result = await insertTextIntoActiveApp(
      "transcript",
      { ...OPTIONS, pressEnterAfterPaste: true },
      f.deps
    );

    expect(result).toEqual({ ok: true, value: { inserted: true } });
    expect(f.keyTapEnter).toHaveBeenCalledTimes(1);
  });

  it("does not press enter when the paste never landed", async () => {
    const f = makeFakes({
      stash: "",
      keyTapError: new Error("hook not running"),
      powershellError: new Error("powershell rejected"),
    });

    await insertTextIntoActiveApp(
      "transcript",
      { ...OPTIONS, pressEnterAfterPaste: true },
      f.deps
    );

    expect(f.keyTapEnter).not.toHaveBeenCalled();
  });
});

/**
 * The clipboard is the delivery mechanism, so overwriting it is the one
 * destructive thing this module does. `writeText` clears every other format
 * and `readText` cannot see them, so the previous contents have to be stashed
 * in whatever flavour they are in and put back afterwards.
 *
 * Refusing to write at all, which is what this used to do for an image, lost
 * the dictation instead: nothing reached the clipboard, and the overlay still
 * claimed the transcript had been copied.
 */
describe("clipboard preservation", () => {
  const image = { isEmpty: () => false } as unknown as NativeImage;

  const withFormats = (
    formats: string[],
    stash = ""
  ): {
    deps: PasteDeps;
    writeText: ReturnType<typeof vi.fn<(t: string) => void>>;
    writeImage: ReturnType<typeof vi.fn<(i: NativeImage) => void>>;
  } => {
    const writeText = vi.fn<(text: string) => void>();
    const writeImage = vi.fn<(img: NativeImage) => void>();
    return {
      writeText,
      writeImage,
      deps: {
        getFocusedWindow: () => null,
        clipboard: { readText: () => stash, writeText },
        availableFormats: () => formats,
        readImage: () => image,
        writeImage,
        keyTap: () => {},
        execPowershell: () => Promise.resolve(),
        delay: () => Promise.resolve()
      }
    };
  };

  it("delivers the transcript and puts a copied image back", async () => {
    const { deps, writeText, writeImage } = withFormats(["image/png"]);

    const result = await insertTextIntoActiveApp("the transcript", OPTIONS, deps);

    expect(writeText).toHaveBeenCalledWith("the transcript");
    expect(writeImage).toHaveBeenCalledWith(image);
    expect(result.ok && result.value.inserted).toBe(true);
  });

  /**
   * A file selection cannot round trip through this module. Delivering and
   * not restoring beats losing the dictation: the user can copy the files
   * again, they cannot say the five minutes again.
   */
  it("still delivers when the clipboard holds something it cannot restore", async () => {
    const { deps, writeText, writeImage } = withFormats(["Files"]);

    const result = await insertTextIntoActiveApp("the transcript", OPTIONS, deps);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("the transcript");
    expect(writeImage).not.toHaveBeenCalled();
    expect(result.ok && result.value.inserted).toBe(true);
  });

  it("still delivers when the clipboard holds only text", async () => {
    const { deps, writeText } = withFormats(["text/plain"], "old text");

    const result = await insertTextIntoActiveApp("the transcript", OPTIONS, deps);

    expect(writeText).toHaveBeenNthCalledWith(1, "the transcript");
    expect(writeText).toHaveBeenNthCalledWith(2, "old text");
    expect(result.ok && result.value.inserted).toBe(true);
  });

  /** Rich copies advertise html alongside plain text; both round trip. */
  it("treats a rich text copy as restorable text", async () => {
    const { deps, writeText, writeImage } = withFormats(
      ["text/plain", "text/html"],
      "old text"
    );

    await insertTextIntoActiveApp("the transcript", OPTIONS, deps);

    expect(writeText).toHaveBeenNthCalledWith(2, "old text");
    expect(writeImage).not.toHaveBeenCalled();
  });

  it("still delivers when the clipboard is empty", async () => {
    const { deps, writeText } = withFormats([]);

    const result = await insertTextIntoActiveApp("the transcript", OPTIONS, deps);

    expect(writeText).toHaveBeenCalledWith("the transcript");
    expect(result.ok && result.value.inserted).toBe(true);
  });

  /**
   * A throw while putting the old clipboard back used to reject out of the
   * whole function, turning an already-delivered transcript into a reported
   * failure. The restore is best effort.
   */
  it("reports success when restoring the clipboard throws", async () => {
    const writeText = vi.fn<(text: string) => void>((text) => {
      if (text === "old text") throw new Error("clipboard locked");
    });
    const deps = {
      getFocusedWindow: () => null,
      clipboard: { readText: () => "old text", writeText },
      availableFormats: () => ["text/plain"],
      keyTap: () => {},
      execPowershell: () => Promise.resolve(),
      delay: () => Promise.resolve()
    } as unknown as PasteDeps;

    const result = await insertTextIntoActiveApp("the transcript", OPTIONS, deps);

    expect(result.ok && result.value.inserted).toBe(true);
  });
});
