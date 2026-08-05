# Struq Voice: architecture

Tray-resident Windows dictation. Hold a key, speak, release, and the transcript
lands at the caret in whatever app was focused. This document is the Phase 0
record; see `IMPLEMENTATION_PLAN.md` for the full specification and
`DESIGN_SYSTEM.md` for the binding visual system.

## Process and window model

Three window types plus the main process:

```
MAIN PROCESS
  lifecycle · ipc · (later: tray, hotkeys, capture session, engines, paste, db)
    |
    +-- MAIN WINDOW    frameless, on demand. Dictate, History, Models, Settings.
    +-- OVERLAY        frameless, transparent, never focusable. The capture pill.
    +-- RECORDER       hidden, never focused, permanently warm microphone.
```

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
electron.vite.config.ts   three main/preload/renderer entries
src/
  shared/                 ipc.ts (single source) · result.ts (Result<T>)
  main/                   index.ts (lifecycle) · ipc.ts (typed dispatch)
  preload/                main.ts · overlay.ts · recorder.ts
  renderer/
    styles/               main.css · theme.css (Velden Linen Forest tokens)
    main/                 index.html · main.tsx · App.tsx
    overlay/              index.html · overlay.tsx · Overlay.tsx
    recorder/             index.html · recorder.ts
e2e/
  helpers/launch.ts       harness: strips ELECTRON_RUN_AS_NODE, fresh userData
  boot.spec.ts            launch, title, one window, zero console errors
docs/                     this directory
scripts/                  rebuild-native-modules.mjs
```

## Boot order (main process)

1. `STRUQ_VOICE_USERDATA` applied before `app` is ready, so e2e never touches
   the real profile.
2. Single instance lock. A second launch focuses the existing window.
3. `whenReady`: `Menu.setApplicationMenu(null)`, IPC handlers, main window.
4. `window-all-closed` quits on Windows.

## Verification

Every phase ends green: `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm test`, `pnpm test:e2e` with zero console errors, committed on its own.

The e2e harness strips `ELECTRON_RUN_AS_NODE` (leaked by VS Code terminals),
sets `STRUQ_VOICE_E2E=1` and `STRUQ_VOICE_ENGINE=mock`, and points userData at
a fresh temp dir. Every spec ends asserting `consoleErrors` is empty.
