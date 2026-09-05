# Struq Voice: architecture

Tray-resident Windows dictation. Hold a key, speak, release, and the transcript
lands at the caret in whatever app was focused. This document owns the process
and window model; see `DESIGN_SYSTEM.md` for the binding visual system and
`FEATURES.md` for what is built.

## Process and window model

Four window types plus the main process and the meeting worker:

```
MAIN PROCESS
  lifecycle · ipc · tray · hotkeys · capture session · engines · paste · db
  meeting session (state machine) · archive writer · worker client
    |
    +-- MAIN WINDOW    frameless, on demand. Dictate, Meetings, History,
    |                  Models, Settings.
    +-- OVERLAY        frameless, transparent, never focusable. The capture pill.
    +-- RECORDER       hidden, never focused, permanently warm microphone.
    +-- MEETING        hidden, on demand, never focused. Loopback + mic
    |                  capture, opus archive encoder. Created when a meeting
    |                  starts, destroyed when it stops.
    |
    +-- MEETING WORKER  utilityProcess (struq-meeting), forked on start,
                       killed on stop. VAD -> local ASR or typed cloud
                       utterances -> speaker clustering.

## Why meeting transcription runs out of process

`sherpa-onnx-node`'s `recognizer.decode()` is a synchronous blocking native
call. For a 3 second dictation that is fine; for continuous meeting decoding
it would stall the main process, and with it the tray, IPC, settings store,
hotkey dispatch and every window pump, for most of the meeting. A
`utilityProcess` gets its own event loop, crash isolation (a segfault inside
ONNX ends the meeting, not the app) and memory that is genuinely released on
kill. The cost is a second copy of the model in RAM while a meeting runs,
which is the correct trade and why the process is spawned per meeting rather
than kept warm.

Meeting engine selection is separate from dictation. Local meetings decode in
the worker. For OpenRouter meetings the worker still owns VAD and speaker
attribution, then emits ordered PCM utterances to main. Main alone reads the
stored API key and serializes cloud requests before writing timestamped rows.
No secret crosses IPC or the worker boundary.

Shutdown is coordinated in main by one idempotent async path. Tray Quit and
updater installation stop the meeting, flush the archive, wait for the bounded
worker drain, then dispose windows, hotkeys, updater timers, engines and the
database. A failed stage is logged and does not prevent later cleanup.

Phase 0 creates only the main window. The overlay and recorder windows land in
Phase 1, the audio pipeline in Phase 2.

## Boundaries, enforced by lint and review

- The renderer never imports from `src/main/`.
- `src/shared/` has no side effects and no Electron imports. Both processes
  import from it freely.
- Every IPC channel and payload type is declared in `src/shared/ipc.ts` and
  nowhere else.
- Every window: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. No exceptions.
- The overlay can never take focus: `focusable: false`, shown with
  `showInactive()`, never `show()`. Losing this property breaks global paste.

## IPC flow

Channels are declared in `src/shared/ipc.ts`. The preloads expose a typed
bridge via `contextBridge` (`window.struqVoice`); main registers handlers in
`src/main/ipc.ts` that only forward to the window or process, no logic.

## File tree

```
electron.vite.config.ts   four main/preload/renderer entries (plus the
                          meeting worker as a second main entry)
src/
  shared/                 ipc.ts (single source) · result.ts (Result<T>)
                          hardware.ts (profile, tier, recommendation)
                          meeting.ts · meeting-assets.ts
  main/                   index.ts (lifecycle) · ipc.ts (typed dispatch)
    hardware/detect.ts    os + getGPUInfo probing, degrades to unknown
    meeting/              meeting-session.ts (state machine) · assets.ts
                          archive-writer.ts · worker-client.ts · ipc.ts
                          loopback.ts · export.ts
      worker/             index.ts (utilityProcess entry) · protocol.ts
                          vad-lane.ts · speaker-clusterer.ts
  preload/                main.ts · overlay.ts · recorder.ts · meeting.ts
  renderer/
    styles/               main.css · theme.css (Evergreen and Ember tokens)
    main/                 index.html · main.tsx · App.tsx
      components/ui/      the shared visual layer, built on the tokens
      onboarding/         first-run takeover, one file per step
      views/              Dictate · Meetings · History · Dictionary · Models
                          · Settings
    overlay/              index.html · overlay.tsx · Overlay.tsx
    recorder/             index.html · recorder.ts
    meeting/              index.html · meeting.ts · audio.ts
                          meeting-collector.worklet.js
e2e/
  helpers/launch.ts       harness: strips ELECTRON_RUN_AS_NODE, fresh userData
  boot.spec.ts            launch, title, one window, zero console errors
docs/                     this directory
scripts/                  rebuild-native-modules.mjs
```

## First run

Onboarding is a renderer takeover gated on main-process state. The decision
lives in `settings.onboarding.completed` rather than renderer localStorage,
for three reasons: main can act on it, clearing the web cache cannot replay
it, and it is testable as a pure function (`shouldRunOnboarding`).

```
boot ──▶ detectHardware() in background, never blocking
             │
             ▼
App reads settings once ──▶ shouldRunOnboarding?
             │                      │
             │ no                   │ yes
             ▼                      ▼
    rail + views          Onboarding takeover
                          mic ▸ hotkey ▸ engine ▸ try it
                                 │
                          model download starts on MOUNT,
                          not on reaching the engine step
                                 │
                                 ▼
                       onboarding:complete writes the flag
```

Three channels serve it, declared in `src/shared/ipc.ts` like every other:
`onboarding:get-profile` (hardware plus recommendation),
`onboarding:start-recommended` (sets the engine, then starts the download),
and `onboarding:complete`. Progress, mic levels, device lists and capture
state all reuse the existing broadcasts rather than adding new ones.

Detection failure is not an error path: `detectHardware` returns the unknown
profile, which classifies as balanced and still yields a usable
recommendation. Under `STRUQ_VOICE_E2E=1` main marks onboarding complete at
boot, so no spec ever meets the takeover.

## Boot order (main process)

1. `STRUQ_VOICE_USERDATA` applied before `app` is ready, so e2e never touches
   the real profile.
2. Single instance lock. A second launch focuses the existing window.
3. `whenReady`: `Menu.setApplicationMenu(null)`, IPC handlers, main window.
4. Hardware detection starts in the background and resolves into a cached
   profile the onboarding handlers read.
5. `window-all-closed` quits on Windows.

## Verification

Every phase ends green: `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm test`, `pnpm test:e2e` with zero console errors, committed on its own.

The e2e harness strips `ELECTRON_RUN_AS_NODE` (leaked by VS Code terminals),
sets `STRUQ_VOICE_E2E=1` and `STRUQ_VOICE_ENGINE=mock`, and points userData at
a fresh temp dir. Every spec ends asserting `consoleErrors` is empty.
