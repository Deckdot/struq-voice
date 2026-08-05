# Struq Voice troubleshooting

Practical answers for the failures this app is known to hit. Work the sections
top to bottom; each one names the cause and the fix.

## The app does not start

1. **Native module mismatch.** Struq Voice runs `better-sqlite3`,
   `uiohook-napi` and `sherpa-onnx-node` against Electron 39. After a fresh
   clone run:

   ```bash
   pnpm install
   ```

   which triggers `scripts/rebuild-native-modules.mjs`. If a module still
   fails to load, rebuild it explicitly:

   ```bash
   pnpm rebuild better-sqlite3
   pnpm rebuild uiohook-napi
   ```

   Every native module degrades rather than preventing boot: history becomes
   unavailable, press-and-hold falls back to the toggle shortcut, and the
   Parakeet engine reports "runtime not installed" in Settings.

2. **`pnpm dev` launches but nothing is downloadable.** The Electron binary
   downloads through a postinstall script. If `node_modules/electron/path.txt`
   is missing, the binary did not download:

   ```bash
   node node_modules/electron/install.js
   ```

## Press-and-hold stops working mid-session

This is the known uiohook/getUserMedia interaction. The structural fix is the
hidden recorder window: the microphone stream is acquired while unfocused, and
the keyboard hook starts only after the stream is live. If PTT dies anyway:

- Re-launch the app. The hook re-registers on boot.
- The toggle shortcut (`Ctrl+Shift+Space`) and the tray capture button keep
  working and are independent of the low-level hook.

## Dictation inserts nothing

The paste chain is: decide target, stash clipboard, write transcript, send
Ctrl+V, restore clipboard.

1. **One of our windows has focus.** The app returns `inserted: false` and the
   renderer is expected to insert into its own field. If you are dictating
   into the main window, that is the designed path.
2. **Windows UIPI.** Synthesized input is silently dropped when a non-elevated
   process sends keystrokes to an elevated (admin) window. The transcript is
   already on the clipboard in that case, so press Ctrl+V manually. The app
   says "Copied, press Ctrl+V" rather than failing.
3. **Clipboard restore races the target.** Some apps read the clipboard
   asynchronously. Raise the restore delay in Settings if a paste lands empty.

## The microphone produces empty transcripts

- The stream watchdog reports `arming` and retries when the device drops or
  mutes. A dead mic never silently produces empty text.
- Check that no other app has exclusive hold of the microphone (conference
  tools, browser tabs).
- In Settings, verify the engine is not Mock. The Mock engine returns a fixed
  fake transcript on every capture.

## A capture never ends

- The stuck-key watchdog force-stops any capture at `maxCaptureMs` (default
  120s) if the key-up is eaten by sleep, alt-tab or a crash.
- Escape cancels the current capture. Nothing is pasted and nothing is
  written to history on cancel.

## Downloading a model fails or stalls

- Downloads are resumable across restarts and capped at three concurrent
  files. Cancel and retry resumes, it does not restart.
- Every file is sha256-verified before it is installed. A hash mismatch
  deletes the partial and reports an error; retry fetches it again.
- The Models view shows real progress and per-model disk usage.

## Tests

- The suite runs headless; the keyboard-hook spec does not, because it needs
  real OS focus and key events.
- `ELECTRON_RUN_AS_NODE` (leaked by VS Code) breaks Playwright launches with
  an opaque "Process failed to launch!" error. The harness strips it; if you
  launch manually, unset it first.
