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

### Onboarding and hardware
- Machine profiling: cores and memory from Node `os`, GPU vendor from
  `app.getGPUInfo("basic")`, CUDA runtime from the whisper.cpp DLL probe.
  No subprocess calls, and every probe degrades to the unknown profile
  rather than blocking boot (`src/shared/hardware.ts`,
  `src/main/hardware/detect.ts`).
- One model recommended per machine, named with the hardware that chose it:
  Parakeet v3 for a balanced or capable PC, whisper base q5_1 for a light
  one. Pure and unit tested.
- First run is a full-window flow with four steps: microphone (arrives
  satisfied, live meter), hotkey (defaults already registered), engine (the
  download starts on mount, not on arrival), and a real capture the user
  performs themselves. Skipping is as cheap as continuing and still leaves a
  working app.
- Completion lives in the settings schema (`onboarding.completed`), so main
  can gate on it and clearing the web cache cannot replay it. An install that
  predates the block and already has a real engine is treated as complete.
  Skipped entirely under `STRUQ_VOICE_E2E=1`.

### Interface
- Application shell: custom title bar, left navigation rail (Dictate,
  History, Models, Settings), persistent status cluster at the bottom
  of the rail, flexible content region. Ctrl+1..4 jumps between
  pages, Ctrl+K opens the command palette, Esc closes any overlay.
- Shared component layer in `src/renderer/main/components/ui/`: the
  full component inventory (Button, IconButton, Badge, Kbd, Field,
  SettingsGroup, SettingsRow, Switch, Checkbox, RadioGroup, Select,
  TextInput, NumberInput, SearchInput, Slider, SegmentedControl, Tabs,
  Tooltip, Popover, DropdownMenu, Dialog, Disclosure, ProgressBar,
  Skeleton, EmptyState, InlineError, StatusDot, HotkeyRecorder,
  TranscriptRow, ModelRow, Card, Section). Views build from these
  rather than re-typing Tailwind.
- Dictate is the readiness home: one headline that answers "is it
  ready?", the hold and toggle chords side by side, a live
  microphone meter, the last transcript, three "what lives where"
  cards, and a status panel with the fix offered inline.
- History is a virtualized list grouped by day (Today, Yesterday, then
  weekday + date), with a search field, copy and a two-step delete per
  row. Roving tabindex, Enter to copy, Delete to remove.
- Models leads with a "Best for this computer" panel named with the
  hardware that chose it, then the full catalog as aligned rows with
  size, languages, speed, state and actions in fixed columns.
- Settings is six categories: General, Capture, Transcription,
  Delivery, Text, Appearance. Each is a SettingsGroup of related
  rows. Advanced values (min/max capture, pre-roll, restore delay,
  live transcript interval) live behind a Disclosure in their
  category. The OpenRouter key field, the model picker, and the
  words-to-fix editor all live in their category. The voice service
  picker, the backup service picker, and the theme picker all
  apply immediately.
- The capture pill is the floating overlay window. Five states
  with object continuity on the same canvas: arming, listening,
  transcribing, delivering, error. The waveform decays into a thin
  processing line during transcribing, so the user sees the audio
  being worked on without a generic spinner.
- Theme is System, Light, or Dark. System follows the Windows setting
  live. Both themes are designed: dark is not an inversion of light.
- Views built against Evergreen and Ember
  (`docs/DESIGN_SYSTEM.md`).

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
  tokens, now through the shared layer in `components/ui/`. The "default
  shadcn skin ships by accident" risk is therefore moot, but it is a
  deviation from the plan's letter.
- GPU detection identifies the vendor but not VRAM, because that needs
  `nvidia-smi` or WMI and both can hang for seconds during boot. The CUDA
  runtime check is a file probe, so a card without the whisper.cpp CUDA
  build present is classified on its cores and memory alone.
- The onboarding "try it" step is the one part not covered by a unit test:
  it needs a real capture. Worth an e2e spec when the user wants one.

## Notes for maintainers

- Native modules target Electron 39 and are rebuilt by
  `scripts/rebuild-native-modules.mjs` on `postinstall`. Do not bump
  Electron without explicit approval.
- `pnpm test:e2e` needs `electron-vite build` first (the script does it).
- Test modes never synthesize keystrokes into the real desktop; the deliver
  path is a no-op under `STRUQ_VOICE_E2E=1` / `STRUQ_VOICE_HOOK_TEST=1`.
