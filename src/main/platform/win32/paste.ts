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
 * - Otherwise: stash the clipboard, write the transcript, synthesize Ctrl+V
 *   via `uIOhook.keyTap` (~2ms). On failure, fall back to the StruqADE
 *   PowerShell SendKeys hop, kept verbatim. The command string is static;
 *   the transcript travels through the clipboard, never through the shell.
 * - Restore the stashed clipboard after a configurable delay: some apps read
 *   the clipboard asynchronously, and restoring too fast makes the paste
 *   land empty.
 * - Windows UIPI silently drops synthesized input sent from a non-elevated
 *   process to an elevated window. The transcript is already on the
 *   clipboard in that case, so report `inserted: false` and let the overlay
 *   say "Copied, press Ctrl+V". Do not fight it.
 *
 * Everything electron-specific is injected as function dependencies: the
 * unit tests pass fakes, and index.ts calls this plainly and gets the real
 * BrowserWindow, clipboard, uIOhook and PowerShell wiring by default.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BrowserWindow, clipboard } from "electron";
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

export interface PasteOutcome {
  readonly inserted: boolean;
}

export interface PasteDeps {
  readonly getFocusedWindow: () => BrowserWindow | null;
  readonly clipboard: Pick<typeof clipboard, "readText" | "writeText">;
  /**
   * What the clipboard currently holds. Writing text clears every other
   * format, so this is what tells us whether an overwrite would destroy
   * something we cannot put back.
   */
  readonly availableFormats?: () => string[];
  readonly keyTap: () => void;
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
 * Whether overwriting the clipboard would destroy something we cannot put
 * back. `writeText` is the only restore tool available here, so text is the
 * only content that survives a round trip.
 *
 * A runtime without `availableFormats` (an older injected fake) keeps the
 * previous behaviour rather than blocking delivery: unknown is treated as
 * text-only, which is what it always assumed.
 */
const holdsUnrestorableContent = (deps: PasteDeps, stashedText: string): boolean => {
  const formats = deps.availableFormats?.();
  if (formats === undefined) return false;
  return formats.some((format) => {
    if (format.startsWith("text/")) return false;
    // Some apps advertise a text flavour alongside rich content. If the text
    // we stashed round-trips the meaningful part, the overwrite is safe.
    return stashedText.length === 0 || !format.startsWith("public.utf8");
  });
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

  const stashed = deps.clipboard.readText();
  const stashedSomething = stashed.length > 0;

  // Writing text clears every other clipboard format, and `readText` cannot
  // see them, so an image or a file selection used to be destroyed silently
  // and reported as a successful paste. We can only put text back, so when
  // the clipboard holds anything else, leave it alone and let the renderer
  // deliver instead. Losing the user's copied image to paste a transcript is
  // not a trade the app gets to make on their behalf.
  if (options.restoreClipboard && holdsUnrestorableContent(deps, stashed)) {
    return ok({ inserted: false });
  }

  try {
    deps.clipboard.writeText(text);
  } catch (error) {
    return fail({
      code: "UNKNOWN",
      message: error instanceof Error ? error.message : "Could not write to clipboard.",
    });
  }

  try {
    deps.keyTap();
  } catch {
    // Keystroke synthesis failed (hook not running, policy). Fall back to
    // the PowerShell SendKeys hop.
    try {
      await deps.execPowershell();
    } catch {
      // UIPI / elevated target / missing Windows Forms. The transcript is
      // already on the clipboard, so the overlay says "Copied, press
      // Ctrl+V" instead of failing the whole flow. Leave the clipboard as
      // it is so the manual paste still works.
      return ok({ inserted: false });
    }
  }

  if (options.pressEnterAfterPaste === true) {
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

  if (options.restoreClipboard && stashedSomething) {
    // Some apps read the clipboard asynchronously; restoring too fast makes
    // the paste land empty.
    await deps.delay(options.restoreClipboardDelayMs);
    try {
      deps.clipboard.writeText(stashed);
    } catch {
      // The restore is best effort. A throw here used to reject out of the
      // whole function with the transcript already delivered, turning a
      // successful paste into a reported failure.
    }
  }

  return ok({ inserted: true });
};
