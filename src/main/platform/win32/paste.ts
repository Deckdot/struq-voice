/**
 * Paste delivery: put a transcript into whatever window the user was in.
 *
 * The capture overlay is `focusable: false`, so the Windows foreground
 * window never changes while it is visible. That is what makes a synthesized
 * Ctrl+V land in the app the user was actually in: there is no window handle
 * to capture and restore. The decision is made here, at delivery time,
 * because transcription takes seconds and the user may have switched windows.
 *
 * - One of our windows is focused: return `inserted: false` and let the
 *   renderer insert into its own field.
 * - Otherwise: stash the clipboard, write the transcript, let the write
 *   settle, release any modifier the user is still holding, then synthesize
 *   Ctrl+V via `uIOhook.keyTap` (~2ms). On failure, fall back to the
 *   StruqADE PowerShell SendKeys hop, kept verbatim. The command string is
 *   static; the transcript travels through the clipboard, never through the
 *   shell.
 * - Restore the stashed clipboard after a configurable delay: some apps read
 *   the clipboard asynchronously, and restoring too fast makes the paste
 *   land empty. An image is stashed and restored the same way text is, so
 *   delivering a transcript never costs the user what they had copied.
 * - The transcript is written whatever the clipboard held. Refusing to write
 *   over a format we cannot restore used to lose the dictation outright,
 *   which is a far worse trade than replacing something the user can copy
 *   again. Only the restore is skipped in that case.
 * - Windows UIPI silently drops synthesized input sent from a non-elevated
 *   process to an elevated window. The transcript is already on the
 *   clipboard in that case, so report `inserted: false` and leave it there
 *   for the user to paste. Do not fight it.
 *
 * Everything electron-specific is injected as function dependencies: the
 * unit tests pass fakes, and index.ts calls this plainly and gets the real
 * BrowserWindow, clipboard, uIOhook and PowerShell wiring by default.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BrowserWindow, clipboard } from "electron";
import type { NativeImage } from "electron";
import { uIOhook, UiohookKey } from "uiohook-napi";
import type { Result } from "../../../shared/result";
import { fail, ok } from "../../../shared/result";

const execFileAsync = promisify(execFile);

export interface PasteOptions {
  readonly automaticPaste: boolean;
  readonly restoreClipboard: boolean;
  readonly restoreClipboardDelayMs: number;
  readonly pressEnterAfterPaste?: boolean;
}

/**
 * How long to let the clipboard settle before synthesizing the keystroke.
 *
 * `writeText` returns as soon as Windows accepts the data, not once the
 * foreground app can read it back. Firing Ctrl+V in the same tick raced that
 * handover, and the app that lost the race pasted whatever the clipboard held
 * before: the previous transcript, or nothing. It is the single most common
 * reason a dictation "did not paste".
 */
const CLIPBOARD_SETTLE_MS = 40;

/**
 * Modifier keycodes, for releasing anything the user is still physically
 * holding when delivery lands. Push-to-talk stops on the trigger key coming
 * up, which is usually before the modifier does, so a fast decode can
 * synthesize its Ctrl+V while Shift or Alt is still down. The target then
 * sees Ctrl+Shift+V, which is a different command in most editors and no
 * command at all in some.
 */
const MODIFIER_KEYS: readonly number[] = [
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight
];

export interface PasteOutcome {
  readonly inserted: boolean;
}

export interface PasteDeps {
  readonly getFocusedWindow: () => BrowserWindow | null;
  readonly clipboard: Pick<typeof clipboard, "readText" | "writeText">;
  /**
   * Read and write the clipboard's image, so a copied screenshot survives a
   * dictation. Absent on older injected fakes, which then behave as before.
   */
  readonly readImage?: () => NativeImage | null;
  readonly writeImage?: (image: NativeImage) => void;
  /**
   * What the clipboard currently holds. Writing text clears every other
   * format, so this is what tells us whether an overwrite would destroy
   * something we cannot put back.
   */
  readonly availableFormats?: () => string[];
  readonly keyTap: () => void;
  /** Release a modifier the user may still be holding down. */
  readonly releaseModifiers?: () => void;
  readonly keyTapEnter?: () => void;
  readonly execPowershell: () => Promise<void>;
  readonly execPowershellEnter?: () => Promise<void>;
  readonly delay: (ms: number) => Promise<void>;
}

/**
 * The PowerShell SendKeys hop, ported verbatim from StruqADE
 * voice-service.ts sendPasteKeystroke. The command string is static; the
 * transcript travels through the clipboard, never through the shell, so
 * there is nothing to escape or inject.
 */
const sendPasteKeystroke = async (): Promise<void> => {
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
    ],
    { timeout: 5_000, windowsHide: true },
  );
};

const sendEnterKeystroke = async (): Promise<void> => {
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
    ],
    { timeout: 5_000, windowsHide: true },
  );
};

const createDefaultDeps = (): PasteDeps => ({
  getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text: string) => {
      clipboard.writeText(text);
    },
  },
  availableFormats: () => clipboard.availableFormats(),
  readImage: () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? null : image;
  },
  writeImage: (image: NativeImage) => {
    clipboard.writeImage(image);
  },
  releaseModifiers: () => {
    for (const key of MODIFIER_KEYS) {
      uIOhook.keyToggle(key, "up");
    }
  },
  keyTap: () => {
    uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
  },
  keyTapEnter: () => {
    uIOhook.keyTap(UiohookKey.Enter);
  },
  execPowershell: sendPasteKeystroke,
  execPowershellEnter: sendEnterKeystroke,
  delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/**
 * What the clipboard holds that a plain `writeText` would destroy.
 *
 * `writeText` clears every other format and `readText` cannot see them, so an
 * image or a file selection is silently lost. Text and images both round trip
 * through this module; anything else (a file selection, an app's private
 * flavour) does not.
 *
 * A runtime without `availableFormats` (an older injected fake) keeps the
 * previous behaviour rather than blocking delivery: unknown is treated as
 * text-only, which is what it always assumed.
 */
type ClipboardContent = "text" | "image" | "unrestorable";

const classifyClipboard = (deps: PasteDeps): ClipboardContent => {
  const formats = deps.availableFormats?.();
  if (formats === undefined) return "text";
  const foreign = formats.filter((format) => !format.startsWith("text/"));
  if (foreign.length === 0) return "text";
  if (
    deps.readImage !== undefined &&
    deps.writeImage !== undefined &&
    foreign.every((format) => format.startsWith("image/"))
  ) {
    return "image";
  }
  return "unrestorable";
};

/**
 * Deliver a transcript to whatever the user is focused on.
 *
 * Decision is made here, at delivery time (transcription takes a few
 * seconds, the user may have switched windows since recording):
 *
 *   - One of our windows has OS focus: return `inserted: false`; the
 *     renderer inserts into its own focused element.
 *   - Otherwise: clipboard + synthesized Ctrl+V into the foreground app.
 */
export const insertTextIntoActiveApp = async (
  text: string,
  options: PasteOptions,
  deps: PasteDeps = createDefaultDeps(),
): Promise<Result<PasteOutcome>> => {
  if (!options.automaticPaste) {
    return ok({ inserted: false });
  }

  if (deps.getFocusedWindow() !== null) {
    return ok({ inserted: false });
  }

  const content = classifyClipboard(deps);
  const stashedText = content === "text" ? deps.clipboard.readText() : "";
  const stashedImage = content === "image" ? (deps.readImage?.() ?? null) : null;

  // An earlier version returned here without writing anything whenever the
  // clipboard held a format it could not put back. The overlay still told the
  // user the transcript had been copied, and it had not been: the words were
  // gone. Delivery now always happens. What varies is whether the previous
  // contents can be restored afterwards.
  try {
    deps.clipboard.writeText(text);
  } catch (error) {
    return fail({
      code: "UNKNOWN",
      message: error instanceof Error ? error.message : "Could not write to clipboard.",
    });
  }

  // Windows accepts the write before the foreground app can read it back, so
  // pasting in the same tick races the handover and lands the previous
  // clipboard instead of this transcript.
  await deps.delay(CLIPBOARD_SETTLE_MS);

  // Push-to-talk ends on the trigger key, which usually comes up before the
  // modifier does. Ctrl+V synthesized on top of a held Shift or Alt reaches
  // the target as a different shortcut entirely.
  try {
    deps.releaseModifiers?.();
  } catch {
    // Best effort. A hook that cannot toggle keys can still tap them.
  }

  let inserted = true;
  try {
    deps.keyTap();
  } catch {
    // Keystroke synthesis failed (hook not running, policy). Fall back to
    // the PowerShell SendKeys hop.
    try {
      await deps.execPowershell();
    } catch {
      // UIPI / elevated target / missing Windows Forms. The transcript is on
      // the clipboard, so the user can still paste it themselves. Leave the
      // clipboard alone in that case: restoring it would take away the only
      // copy of what they just said.
      inserted = false;
    }
  }

  if (inserted && options.pressEnterAfterPaste === true) {
    await deps.delay(50);
    try {
      deps.keyTapEnter?.();
    } catch {
      try {
        await deps.execPowershellEnter?.();
      } catch {
        // Target app rejected enter synthesis
      }
    }
  }

  const canRestore =
    inserted &&
    options.restoreClipboard &&
    (stashedImage !== null || stashedText.length > 0);
  if (canRestore) {
    // Some apps read the clipboard asynchronously; restoring too fast makes
    // the paste land empty.
    await deps.delay(options.restoreClipboardDelayMs);
    try {
      if (stashedImage !== null) {
        deps.writeImage?.(stashedImage);
      } else {
        deps.clipboard.writeText(stashedText);
      }
    } catch {
      // The restore is best effort. A throw here used to reject out of the
      // whole function with the transcript already delivered, turning a
      // successful paste into a reported failure.
    }
  }

  return ok({ inserted });
};
