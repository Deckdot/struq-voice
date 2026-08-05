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
  readonly restoreClipboard: boolean;
  readonly restoreClipboardDelayMs: number;
}

export interface PasteOutcome {
  readonly inserted: boolean;
}

export interface PasteDeps {
  readonly getFocusedWindow: () => BrowserWindow | null;
  readonly clipboard: Pick<typeof clipboard, "readText" | "writeText">;
  readonly keyTap: () => void;
  readonly execPowershell: () => Promise<void>;
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

const createDefaultDeps = (): PasteDeps => ({
  getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text: string) => {
      clipboard.writeText(text);
    },
  },
  keyTap: () => {
    uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
  },
  execPowershell: sendPasteKeystroke,
  delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
});

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
  if (deps.getFocusedWindow() !== null) {
    return ok({ inserted: false });
  }

  const stashed = deps.clipboard.readText();
  const stashedSomething = stashed.length > 0;

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

  if (options.restoreClipboard && stashedSomething) {
    // Some apps read the clipboard asynchronously; restoring too fast makes
    // the paste land empty.
    await deps.delay(options.restoreClipboardDelayMs);
    deps.clipboard.writeText(stashed);
  }

  return ok({ inserted: true });
};
