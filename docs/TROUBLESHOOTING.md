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
## A capture never ends

- The stuck-key watchdog force-stops any capture at `maxCaptureMs` (default
  300s) if the key-up is eaten by sleep, alt-tab or a crash.
- Escape cancels the current capture. Nothing is pasted and nothing is
  written to history on cancel.

## Whisper fails with "Command failed:" and a path

- Symptom: picking any whisper model returns `Command failed: C:\...\whisper-cli.exe -m ...`
  with nothing after it. Parakeet and OpenRouter keep working.
- Cause: the runtime directory holds `whisper-cli.exe` without the DLLs it
  links against, so Windows refuses to start the process (0xC0000135,
  STATUS_DLL_NOT_FOUND) and Node reports the command line as the error. A
  runtime carrying those DLLs but no `ggml-cpu-*.dll` gets one step further
  and aborts on `GGML_ASSERT(device) failed`, because ggml finds its CPU
  backend by scanning that directory at runtime.
- Fix: the runtime is judged as a set of files, not by the presence of the
  exe, so an incomplete directory reads as not installed and the boot-time
  install repairs it. Reinstall by hand from Settings > Models if it does not.
- Check what is on disk: `%APPDATA%\struq-voice\runtimes\whisper-cpp` should
  hold `whisper-cli.exe`, `whisper.dll`, `ggml.dll`, `ggml-base.dll` and at
  least one `ggml-cpu-*.dll`.

## Whisper is slow, or the GPU is not being used

- Whisper decodes on the CPU until the CUDA runtime is installed. Models
  shows a "GPU acceleration" card on NVIDIA machines; it is a 670MB download
  and 1.1GB on disk, so nothing fetches it on its own.
- The card is hidden entirely on AMD, Intel and unknown GPUs. The cuBLAS
  build only helps NVIDIA hardware.
- After installing, the next capture uses the GPU. No restart, and there is
  no setting to switch: whisper uses the card whenever the backend loads.
- To confirm, run whisper-cli by hand from
  `%APPDATA%\struq-voice\runtimes\whisper-cpp` and look for
  `load_backend: loaded CUDA backend` and `using CUDA0 backend` on stderr.
- If it still says CPU, ggml could not initialise the card and fell back.
  The shipped build carries kernels for sm_50 to sm_90; an RTX 50-series card
  (sm_120) is outside that range. The fallback is silent by design, so a
  missing driver looks the same as an unsupported card.
- Parakeet is unaffected either way. It runs on the CPU through sherpa-onnx,
  and it is the default engine.

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
