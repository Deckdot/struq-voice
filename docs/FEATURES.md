# Struq Voice: features and current state

What is built, what is current, and what is still open. This is the
project-status index any agent or human should read first, after AGENTS.md.

## Status: all 7 plan phases built

The build plan (`docs/IMPLEMENTATION_PLAN.md`) is fully implemented and
committed. All gates green: `pnpm typecheck`, `pnpm lint`, `pnpm test`
(106 unit tests), and the dev e2e suite (8 specs, headless, green when run
as `pnpm test:e2e`).

## The product loop, end to end

1. Hold `Ctrl+Space` (configurable). uiohook-napi detects key-down/up.
2. Hidden recorder window owns a warm 16kHz mono microphone; captures start
   by appending to a buffer, so no mic-open latency in the hot path.
3. Audio is Int16 PCM, transferred to main, transcribed by an engine,
   cleaned up, and pasted into the focused window via synthesized `Ctrl+V`.
4. The never-focusable overlay shows the live waveform pill.

## Built

### Capture and hotkeys
- PTT hook (default `Ctrl+Space`), toggle (`Ctrl+Shift+Space`), Escape
  cancel, stuck-key watchdog, key-repeat debounce.
- Hotkey reassignment in Settings via a key-capture widget; re-registers at
  runtime without a restart.
- Capture state machine (`idle/arming/listening/transcribing/delivering/
  error`) with 350ms min capture and 120s max capture.

### Audio
- Warm `getUserMedia` + AudioWorklet (`pcm-collector.worklet.js`).
- 30s ring buffer for pre-roll (250ms default), 60Hz analyser levels.
- Microphone device selection and switching, persisted by deviceId with a
  label fallback; `devicechange` handling and a stream watchdog.

### Engines
- Interface in `src/main/engines/types.ts`; router with primary -> fallback
  cascade; local -> cloud cascade requires explicit opt-in.
- `parakeet` (sherpa-onnx-node, default, background warmup).
- `whisper-cpp` (sidecar `whisper-cli.exe`, GPU capable, CPU fallback).
- `openrouter` (OpenRouter STT, cost recorded per transcription).
- `mock` (deterministic test engine).

### Models
- Catalog in `src/shared/models.ts` (Parakeet v3/v2 + whisper large-v3-turbo
  q5_0 + whisper base), real sizes and sha256 from the HF API.
- Resumable range downloader (cap 3 concurrent), sha256 verify, atomic move,
  cancellable, progress at 4Hz.
- Whisper runtime zip download (sha256 verify, extract only `whisper-cli.exe`).
- Import an existing local model directory (copies then verifies).
- Measured realtime factor per engine, computed from real History rows.

### Paste and delivery
- Target decision (our window focused -> renderer inserts, else clipboard +
  synthesized Ctrl+V).
- `uIOhook.keyTap` primary (~2ms) with a PowerShell SendKeys fallback.
- Optional clipboard save/restore with configurable delay.

### Data
- History: better-sqlite3 + Drizzle + FTS5 search, virtualized reader,
  copy/delete, engine/cost metadata.
- Settings: zod-validated JSON, live-updating via IPC, autostart flag.
- Secrets: OpenRouter key in safeStorage (DPAPI), masked in Settings,
  replace/remove actions, env fallback.

### Post-processing
- Trim/collapse whitespace (always on), custom dictionary, filler removal,
  trailing punctuation; pure functions with unit tests.

### Interface
- Main window shell: custom title bar, rail navigation (Dictate, History,
  Models, Settings), Zustand store.
- Command palette (Ctrl+K), first-run steps (mic, engine, hotkey).
- Views built against Velden Linen Forest (`docs/DESIGN_SYSTEM.md`).

### Platform
- NSIS one-click per-user installer, app icon, tray icons.
- Autostart with Windows, hidden to tray; close hides rather than quits.
- Tray: three icon states, tooltip with engine/state, recent transcripts,
  capture toggle, engine radio group, pause, quit.

## Known gaps and deferred work

- `e2e/settings.spec.ts` and `e2e/a11y.spec.ts` from the plan's spec table
  are not written. The user runs e2e and adds these when they want them.
- The manual checklist in `docs/IMPLEMENTATION_PLAN.md` section 7.3 is
  inherently manual and has not been run.
- shadcn/ui components were not adopted; views are hand-built on theme
  tokens. The "default shadcn skin ships by accident" risk is therefore
  moot, but it is a deviation from the plan's letter.

## Notes for maintainers

- Native modules target Electron 39 and are rebuilt by
  `scripts/rebuild-native-modules.mjs` on `postinstall`. Do not bump
  Electron without explicit approval.
- `pnpm test:e2e` needs `electron-vite build` first (the script does it).
- Test modes never synthesize keystrokes into the real desktop; the deliver
  path is a no-op under `STRUQ_VOICE_E2E=1` / `STRUQ_VOICE_HOOK_TEST=1`.
