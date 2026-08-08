# Struq Voice: implementation plan

> **Greenfield build.** This specifies a new repository from an empty directory. There is no
> migration, no legacy, and nothing to preserve. Read this end to end before writing code, along
> with [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

**Owner:** Roy Heilbron
**Target:** Windows 11 x64. Sole supported platform for v1.
**Reference implementation to port from:** `C:\Users\Royhe\Documents\Coding\Projects\1Personal\StruqMain\StruqADE`

---

## 1. The product

Hold a key anywhere in Windows. Speak. Release. The text appears in whatever field you were
focused on.

That single loop is the entire product. Every architectural decision below is justified by it, and
anything that does not serve it is out of scope.

**Qualities, in priority order:**

1. **Fast.** Under one second from key release to visible text on a short utterance. Latency is a
   feature, and architectural overhead in the hot path is a bug.
2. **Invisible until needed.** Tray-resident. Never steals focus. Never interrupts.
3. **Accurate.** Best-in-class local models, with a cloud escape hatch.
4. **Beautiful.** The capture overlay is seen dozens of times a day and should be the nicest piece
   of UI on the machine.

**Out of scope for v1:** macOS, Linux, always-listening, wake words, speaker diarization,
streaming partial results, translation, MCP, Struq auth, multi-user, dark mode.

---

## 2. Stack

Every choice below is deliberate. Where an obvious alternative was rejected, the reason is stated,
because the reason is the useful part.

### Runtime

| Choice | Version | Why |
|---|---|---|
| **Electron** | pin **39.x** | Not 43+. StruqADE runs `better-sqlite3` and `node-pty` on the 39 line in production, so native prebuild availability is a known quantity rather than a gamble. Chosen over Tauri because the reusable overlay and paste code is Electron, `sherpa-onnx-node` is a Node addon, and `uiohook-napi` is how press-and-hold works at all. The ~120MB bundle is the accepted cost. |
| **electron-vite** | 4.x | Handles main, preload and renderer with one config, HMR in the renderer, and multi-entry via `build.rollupOptions.input`. |
| **electron-builder** | 25.x | NSIS, per-user install, no admin required. |
| **pnpm** | 10.x | Already in use. Note `allowBuilds` (section 3). |
| **Node** | 24.x | Installed. |

### Language and quality

TypeScript 5.8 in **strict** mode plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
Both extras matter here: the first catches the array-access bugs that ring buffers invite, the
second stops optional IPC payload fields from silently becoming `undefined`.

ESLint 9 flat config with `typescript-eslint` `strictTypeChecked`. Prettier. Vitest for units,
Playwright for end to end.

### Interface

| Choice | Why |
|---|---|
| **React 19** | Baseline. |
| **Tailwind CSS v4** via `@tailwindcss/vite` | CSS-first config through `@theme`, native OKLCH, no `tailwind.config.ts`, no PostCSS step. The palette is specified in OKLCH, so this is a direct fit rather than a conversion. |
| **shadcn/ui** on Radix | For focus management, keyboard nav and ARIA wiring. **The default skin is replaced wholesale.** See DESIGN_SYSTEM section 9. This is non-negotiable and is the difference between a designed app and a generic one. |
| **motion** (Framer Motion 12) | Spring orchestration, layout transitions, `AnimatePresence`. |
| **lucide-react** | Icons, used with discipline. An icon must carry meaning its label cannot. |
| **cmdk** | Command palette. |
| **@tanstack/react-virtual** | History list virtualisation. |
| **sonner** | Toasts. Used sparingly; never for something the user just watched happen. |
| **@fontsource** | `instrument-sans`, `instrument-serif`, `ibm-plex-mono`. All verified present on npm at 5.3.0. Self-hosted, so the app has no network dependency for type. |

**No router library.** Four routes behind a fixed left rail do not need TanStack Router or React
Router. A discriminated union in the Zustand store is less code, fully typed, and has no history
stack to fight with in a desktop shell.

**Inter is not in this stack.** See DESIGN_SYSTEM section 3.

### State and data

| Choice | Why |
|---|---|
| **Zustand** | Renderer state. Minimal, no provider tree, no boilerplate. |
| **Zod** | One schema per settings object and per IPC payload. Validate at the process boundary, then trust the types inside. |
| **better-sqlite3 + Drizzle ORM** | History. Synchronous, in-process, and FTS5 gives real full-text search over every transcript you have ever dictated. A JSON file would work on day one and be regretted by month three. Native module, so it goes through `@electron/rebuild`. |
| **Electron `safeStorage`** | The OpenRouter key. DPAPI-backed on Windows. The raw key never crosses IPC. |

### Native modules

| Choice | Why |
|---|---|
| **uiohook-napi** | The only way to get key-up events. Electron's `globalShortcut` fires on key-down only, so press-and-hold is impossible without a low-level hook. Also provides `keyTap` for paste synthesis at ~2ms, replacing a 150-400ms PowerShell hop. |
| **sherpa-onnx-node** + `sherpa-onnx-win-x64` | Parakeet TDT and Whisper ONNX inference, offline. |
| **@electron/rebuild** | `postinstall`. Port the script from `StruqADE/scripts/rebuild-native-modules.mjs`. |

Three native modules is the honest cost of this product. Each has a documented degradation path so
a rebuild failure never prevents the app from booting.

---

## 3. Repository bootstrap

From an empty directory. `<repo>` is the new folder.

```bash
cd <repo>
git init
pnpm init
```

**`pnpm-workspace.yaml`** must exist before installing, or pnpm 10 silently skips the postinstall
scripts that download Electron's 215MB binary and build the native modules:

```yaml
allowBuilds:
  electron: true
  esbuild: true
  better-sqlite3: true
  uiohook-napi: true
```

If `node_modules/electron/path.txt` is ever missing after an install, the binary did not download.
Run `node node_modules/electron/install.js`.

Copy [`assets/theme.css`](assets/theme.css) to `src/renderer/styles/theme.css` before building any
UI. Nothing should be styled ad hoc and retrofitted later.

### `package.json` scripts

```jsonc
{
  "scripts": {
    "dev":        "electron-vite dev",
    "build":      "electron-vite build",
    "preview":    "electron-vite preview",
    "typecheck":  "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "lint":       "eslint .",
    "test":       "vitest run",
    "test:e2e":   "electron-vite build && playwright test",
    "pack":       "electron-vite build && electron-builder --dir",
    "dist":       "electron-vite build && electron-builder",
    "postinstall": "node scripts/rebuild-native-modules.mjs"
  }
}
```

`pnpm dev` is the command that must work. It is the first acceptance criterion of Phase 0.

---

## 4. Architecture

### 4.1 Process and window model

```
┌──────────────────────────────────────────────────────────────────────┐
│ MAIN PROCESS                                                         │
│  lifecycle · tray · hotkeys · capture session · engines · paste · db │
└──┬─────────────────┬──────────────────┬──────────────────────────────┘
   │                 │                  │
┌──▼───────────┐ ┌───▼──────────────┐ ┌─▼────────────────────────────┐
│ RECORDER     │ │ OVERLAY          │ │ MAIN WINDOW                  │
│ hidden,      │ │ frameless,       │ │ frameless, on demand         │
│ always alive │ │ never focusable  │ │                              │
│              │ │                  │ │ Dictate · History ·          │
│ warm mic,    │ │ capture pill,    │ │ Models · Settings            │
│ AudioWorklet │ │ live waveform    │ │                              │
└──────────────┘ └──────────────────┘ └──────────────────────────────┘
```

**The recorder window is the most important decision in this plan.** A hidden, never-focused
`BrowserWindow` that owns the microphone permanently. It solves two problems at once:

1. **Latency.** `getUserMedia` costs 100-300ms on Windows. Opening the mic on hotkey press would
   put that in the hot path and clip the first syllable of every utterance. A permanently warm
   stream makes starting a capture free: it is just "begin appending to a buffer".
2. **The uiohook bug.** [uiohook-napi#54](https://github.com/SnosMe/uiohook-napi/issues/54) reports
   the global keyboard hook dying when `getUserMedia` initialises while an Electron window is
   focused. The reported workaround is to allocate the stream while unfocused, which a permanently
   hidden window does by construction.

   **This is a hypothesis, not a verified fact.** Prove it in Phase 2 with ten consecutive capture
   cycles while the main window is focused, before building anything on top of it. Fallbacks are in
   section 9.

**The overlay window.** Port `StruqADE/apps/desktop/src/main/voice-overlay.ts` close to verbatim.
Its comments explain non-obvious requirements and are worth reading before editing. The properties
that matter:

- `frame: false, transparent: true, hasShadow: false`. It draws its own shape.
- `alwaysOnTop: true` **plus** an explicit `setAlwaysOnTop(true, 'floating')` call. The constructor
  option alone is insufficient on Windows.
- **`focusable: false`.** This is what makes the entire product work. Because the overlay can never
  take focus, the Windows foreground window never changes while it is visible, so a synthesised
  Ctrl+V lands in the app the user was actually in. There is no window handle to capture and
  restore.
- `skipTaskbar: true`.
- **`showInactive()`, never `show()`.** `show()` steals focus and silently breaks paste delivery.
  If you find yourself calling `show()` during a capture, you have introduced a bug.
- `paintWhenInitiallyHidden: true`, so the first appearance is not a blank frame.
- Lazy creation in a try/catch. Some locked-down Windows configurations block always-on-top
  windows; fall back to a `Notification`.
- Per-window `focus` **and** `blur` listeners. `app.on('browser-window-focus')` alone is not
  enough, and without the blur half the overlay stays hidden after the first round trip.

**The main window.** Frameless with a custom title bar. Created on demand, hidden rather than
destroyed on close so reopening from the tray is instant.

### 4.2 File tree

```
<repo>/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ playwright.config.ts
├─ vitest.config.ts
├─ eslint.config.mjs
├─ components.json                  # shadcn, Tailwind v4 Vite mode
├─ tsconfig.json / .node.json / .web.json
├─ drizzle.config.ts
├─ scripts/rebuild-native-modules.mjs
├─ docs/  IMPLEMENTATION_PLAN.md · DESIGN_SYSTEM.md · MODELS.md · TROUBLESHOOTING.md
├─ e2e/
│  ├─ helpers/launch.ts             # shared harness + console collector
│  ├─ boot.spec.ts · overlay.spec.ts · settings.spec.ts
│  ├─ transcribe.spec.ts · tray.spec.ts
│  └─ fixtures/sample-16k-mono.pcm
├─ resources/  icon.png · tray/{idle,recording,transcribing}.png (+@2x)
└─ src/
   ├─ shared/                       # imported by main AND renderer. No side effects.
   │  ├─ ipc.ts                     # every channel + payload type. SINGLE SOURCE.
   │  ├─ result.ts                  # Result<T> = ok | fail
   │  ├─ settings.ts                # zod schema + defaults + migrations
   │  ├─ models.ts                  # model catalog
   │  └─ capture.ts                 # CaptureState union, shared by every surface
   ├─ main/
   │  ├─ index.ts                   # lifecycle, single instance, boot order
   │  ├─ ipc.ts                     # thin typed dispatch only, no logic
   │  ├─ tray.ts
   │  ├─ windows/{main,overlay,recorder}-window.ts
   │  ├─ session/capture-session.ts # THE state machine
   │  ├─ hotkeys/{index,toggle-shortcut,ptt-hook}.ts
   │  ├─ engines/{types,router,parakeet,whisper-cpp,openrouter,mock}.ts
   │  ├─ models/{catalog,downloader,installer}.ts
   │  ├─ audio/wav.ts
   │  ├─ platform/win32/{paste,autostart}.ts
   │  ├─ db/{client,schema,migrations}.ts
   │  ├─ store/{settings-store,secrets}.ts
   │  └─ post/text-cleanup.ts
   ├─ preload/{main,overlay,recorder}.ts
   └─ renderer/
      ├─ styles/theme.css           # from assets/theme.css
      ├─ main/      index.html · App.tsx · views/ · components/ · store/
      ├─ overlay/   index.html · Overlay.tsx · Waveform.tsx
      └─ recorder/  index.html · recorder.ts · pcm-collector.worklet.js
```

**Boundaries, enforced by lint:**

- The renderer never imports from `src/main/`.
- `src/shared/` has no side effects and no Electron imports.
- Every IPC channel is declared in `src/shared/ipc.ts` and nowhere else.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every window. No exceptions.

### 4.3 Capture state machine

One authority, in `src/main/session/capture-session.ts`. Tray, overlay and main window all render
from broadcasts of it. Nothing else owns capture state.

```
 idle ──arm──▶ arming ──ready──▶ listening ──stop──▶ transcribing ──ok──▶ delivering
   ▲             │                   │                    │                    │
   │             └──fail─────────────┴───cancel───────────┘                    │
   │                                 │                    │                    │
   └────────── error ◀───────────────┴────────fail────────┘                    │
   │                                                                            │
   └───────────────────── done (auto after 900ms) ◀────────────────────────────┘
```

- `arming` covers only the rare case where the warm stream died (device unplugged, driver reset).
  In the normal path it lasts zero frames.
- `cancel` is `Escape`, registered as a `globalShortcut` for the duration of a capture only, since
  the overlay cannot receive key events.
- Captures shorter than `minCaptureMs` (default 350ms) are discarded silently, absorbing accidental
  taps.

### 4.4 Latency budget

Target: **under 900ms from key release to visible text** on a 5-second utterance. Surface these
numbers in the Debug view and treat regressions as bugs.

| Stage | Budget |
|---|---:|
| Key release detected by hook | 5ms |
| Assemble Int16 PCM | 5ms |
| WAV container, in memory | 2ms |
| Parakeet TDT int8 inference | 150-350ms |
| Text cleanup | 1ms |
| Clipboard write | 5ms |
| Paste synthesis via `uIOhook.keyTap` | 2ms |
| **Ours, total** | **~370ms** |

No disk IO in the hot path. The largest avoidable cost is StruqADE's PowerShell `SendKeys` hop at
150-400ms, which section 5.2 replaces.

---

## 5. The hard parts

### 5.1 Press-and-hold

`globalShortcut` has no key-up event and no way to obtain one, so PTT requires a low-level hook.

- `uIOhook.start()` once, after the recorder window has its stream.
- Match `keydown`/`keyup` on `e.keycode` plus the modifier booleans.
- **Debounce key repeat.** Windows fires repeated `keydown` while held. Track `pttActive` and
  ignore repeats until the matching `keyup`.
- **Watchdog the stuck-key case.** Alt-tabbing or a sleep event can eat the `keyup`. Force-stop at
  `maxCaptureMs` (default 300s) and re-check modifier state on every event.
- **Never block in the callback.** It runs on the hook thread. Set a flag, post to main, return.
  Slow work here makes the user's entire keyboard feel laggy, which is the worst available failure
  mode.
- **Degrade gracefully.** If the module fails to load or `start()` throws: log, disable PTT, show a
  banner in Settings, keep the toggle shortcut working. The app must never fail to boot over this.
- **Disable under test.** `STRUQ_VOICE_E2E=1` skips `start()`. A global keyboard hook inside a test
  runner is hostile.

| Action | Default | Configurable |
|---|---|---|
| Press-and-hold | `Ctrl+Space` (hold) | yes, via a key-capture widget |
| Toggle | `Ctrl+Shift+Space` | yes |
| Cancel during capture | `Escape` | no |

Both must re-register at runtime without a restart, and registration failure must reach the UI
rather than being swallowed.

### 5.2 Paste into the focused window

Works because the overlay is `focusable: false` and the main window is hidden or unfocused, so the
foreground window never changes.

1. **Decide the target.** If `BrowserWindow.getFocusedWindow()` is non-null, one of our windows has
   focus: return `inserted: false` and let the renderer insert into its own field. This is the
   logic at `voice-service.ts:168`.
2. **Save the clipboard.** Stash `clipboard.readText()` if non-empty. Setting: "Restore clipboard
   after paste", default on.
3. **Write the transcript** via `clipboard.writeText`.
4. **Synthesise Ctrl+V.**
   - Primary: `uIOhook.keyTap(UiohookKey.V, ['ctrl'])`. ~2ms, no process spawn. Verify the exact
     signature against the installed version.
   - Fallback: the StruqADE PowerShell hop, kept verbatim. The command string is static and the
     transcript travels via clipboard, never through the shell. **Keep it that way.**
5. **Restore the clipboard** after 400ms, configurable. Some apps read the clipboard
   asynchronously; restoring too fast makes the paste land empty.

**Windows UIPI** silently drops synthesised input sent from a non-elevated process to an elevated
window. The transcript is already on the clipboard when that happens, so the overlay says
"Copied, press Ctrl+V" rather than reporting failure. Document it; do not fight it.

### 5.3 Tray

**StruqADE has no tray. This is new work.**

- Three icon states from the capture session: idle, recording, transcribing. 16x16 plus `@2x`.
- Tooltip carries state and engine: `Struq Voice: idle (Parakeet v3)`.
- **Left click toggles capture.** Makes the tray a control, not decoration.
- **Right click** menu: Start/Stop (with the hotkey as accelerator label), Recent transcripts
  (last 5, truncated to 60 chars, click re-copies), Engine radio group, Open Struq Voice, Settings,
  Pause hotkeys (checkbox, for games), Quit.
- **Close hides, it does not quit.** Quit from the tray or `Ctrl+Q`. One-time balloon on first hide.
- **Single instance lock.** A second launch focuses the existing window rather than starting a
  second tray icon and a second keyboard hook.

### 5.4 Audio pipeline

Owned entirely by the recorder window.

```
getUserMedia({ audio: {
  channelCount: 1,
  echoCancellation: false,   // raw voice, not conferenced voice
  noiseSuppression: false,   // the models denoise better than browser DSP
  autoGainControl: true      // this one genuinely helps
}})
  → AudioContext({ sampleRate: 16000 })      // browser resamples, correctly
      ├→ AnalyserNode → 60Hz level + 32-band FFT → IPC → overlay
      └→ AudioWorkletNode('pcm-collector')
           → 30s ring buffer + active capture buffer
           → Float32 to Int16, transferable ArrayBuffer over IPC
           → main: 16kHz mono WAV container
```

- Request 16kHz on the `AudioContext`. Both engines want it and browser resampling is faster and
  more correct than doing it by hand.
- **AudioWorklet**, not `ScriptProcessorNode` (deprecated, main-thread, glitches under load) and
  not `MediaRecorder` (produces Opus/WebM that then needs decoding).
- **30-second rolling ring buffer while idle.** This buys **pre-roll**: include the 250ms of audio
  *before* the key was pressed, which eliminates clipped first syllables entirely. Setting, default
  250ms, range 0-1000ms. This small trick is a large part of why the app will feel better than the
  alternatives.
- Transfer PCM as a **transferable `ArrayBuffer`**, never base64. Base64 costs 33% size plus a full
  copy on each side.
- **Trim leading and trailing silence** before inference. Shorter audio is faster. Never trim the
  middle.
- **Device selection** persisted by `deviceId` with a `label` fallback, since Windows rotates
  device IDs across reboots. Handle `devicechange`.
- **Stream watchdog.** On `track.onended` or mute, re-acquire and report `arming`. A dead mic must
  never silently produce empty transcripts.

### 5.5 Engines

```ts
export interface TranscribeRequest {
  readonly pcm: Int16Array          // 16kHz mono
  readonly durationMs: number
  readonly language?: string        // ISO-639-1, omit for auto-detect
  readonly signal: AbortSignal
}

export interface TranscribeResult {
  readonly text: string
  readonly language: string | null
  readonly engineId: string
  readonly modelId: string
  readonly inferenceMs: number
  readonly realtimeFactor: number
}

export interface EngineReadiness {
  readonly ready: boolean
  readonly reason?: string          // user-facing, names cause AND fix
  readonly action?: 'download-model' | 'set-api-key' | 'install-runtime'
}

export interface TranscriptionEngine {
  readonly id: string
  readonly displayName: string
  readonly kind: 'local' | 'cloud'
  readiness(): Promise<EngineReadiness>
  warmup(): Promise<void>           // idempotent
  transcribe(req: TranscribeRequest): Promise<Result<TranscribeResult>>
  dispose(): Promise<void>
}
```

**Router.** Primary plus optional fallback. Cascade on not-ready, error, or timeout (20s local,
60s cloud). Report which engine actually produced the text. **Never cascade from local to cloud
without explicit opt-in**, because that would send audio off the machine without the user choosing
to.

#### Parakeet, default, local

`sherpa-onnx-node` + `sherpa-onnx-win-x64`.

| Model | Size | Languages |
|---|---:|---|
| `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` | ~660MB | **Default.** 25 European incl. English, Dutch, German, French, Spanish |
| `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` | ~640MB | English only, better punctuation and casing |

```ts
new OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: `${dir}/encoder.int8.onnx`,
      decoder: `${dir}/decoder.int8.onnx`,
      joiner:  `${dir}/joiner.int8.onnx`,
    },
    tokens: `${dir}/tokens.txt`,
    modelType: 'nemo_transducer',
    numThreads: 8,     // physical cores. SMT hurts here.
    debug: false,
  },
})
```

**Warmup is mandatory.** Loading the int8 encoder takes 1-3 seconds. Do it in the background at
app start, before the first hotkey press, and show "warming" in the tray tooltip. It happens once
per launch, so there is no excuse for it landing in the user's first capture.

Download per-file from the HuggingFace mirror
(`csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`) rather than the `.tar.bz2` GitHub asset.
Per-file is resumable, individually verifiable, and needs no bzip2 decompressor in Node.

#### whisper.cpp, local, GPU

For what Parakeet cannot do: non-European languages, heavy accents, poor recordings.

Spawn `whisper-cli.exe` as a sidecar rather than using a Node binding. Upstream ships CUDA
prebuilds, swapping in a faster build is trivial, and a crash inside the model cannot take down the
app.

- Binary: `whisper-cublas-12.4.0-bin-x64.zip` from
  [ggml-org/whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases), downloaded on
  demand to `userData/runtimes/whisper-cpp/`.
- Model: `ggml-large-v3-turbo-q5_0.bin` (~870MB), with `ggml-base.bin` (148MB) as a light option.
- `whisper-cli.exe -m <model> -f <wav> -l <lang|auto> -t 8 --output-json --no-timestamps -nf`,
  parse JSON from stdout, delete the temp WAV in a `finally`.
- If the CUDA build fails to start (missing runtime DLLs), fall back to CPU and **say so once**.
  Do not silently run 10x slower.

#### OpenRouter, cloud

**Verified:** `POST https://openrouter.ai/api/v1/audio/transcriptions`. A real OpenAI-compatible
endpoint, not the chat-completions audio path.

```jsonc
{
  "model": "openai/whisper-large-v3",
  "input_audio": { "data": "<base64 wav>", "format": "wav" },
  "language": "en",
  "temperature": 0
}
// → { "text": "...", "usage": { "seconds": 9.2, "cost": 0.000508 } }
```

- Slugs: `openai/whisper-large-v3` (default), `openai/whisper-1`. Discover live via
  `GET /api/v1/models?output_modalities=transcription`.
- Limits: 25MB, 60s processing. Enforce the cap and refuse early with a clear message rather than
  sending a doomed request.
- Key in `safeStorage` at `userData/secrets/openrouter.enc`. Port `readVoiceApiKey` /
  `writeVoiceApiKey` from `voice-service.ts:29-67`. **The raw key never crosses IPC.** Settings
  shows a masked placeholder and a "Replace key" action only.
- Resolution order: stored key, then `OPENROUTER_API_KEY`, then unconfigured.
- Show per-transcription cost in History. It keeps the cloud path honest.

### 5.6 Model manager

A first-class surface. Users judge local-AI apps on how the first download feels.

- **Catalog** in `src/shared/models.ts`: id, name, engine, bytes, languages, a one-line "when to
  use this", per-file URLs, per-file SHA-256, license.
- **Downloader:** concurrent per-file, cap 3, HTTP range resume across restarts, SHA-256
  verification, progress at 4Hz (throttled, do not flood IPC), cancellable, atomic move into place
  only after verification.
- **Storage:** `userData/models/<model-id>/`. Show total disk used, offer per-model delete.
- **UI:** a card per model with size, languages, and a speed figure **measured on this machine**
  after first use rather than a static claim. Real transfer rate during download, never a spinner.
- **Import** an existing local directory, for users who already have the models.

### 5.7 Text post-processing

Pure functions in `src/main/post/text-cleanup.ts`, unit tested. Small and fast.

- Trim, collapse internal whitespace runs. Always on.
- **Custom dictionary:** ordered `{ from, to, matchCase, wholeWord }` replacements. This is how
  "Struck" becomes "Struq" and "tow ree" becomes "Tauri". Ships empty, with an "Add to dictionary"
  action on every History row.
- Filler removal (standalone "um", "uh", "erm"). Default off.
- Trailing punctuation. Default off.

No regex over user text without a test.

---

## 6. Interface

Full specification in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md). Read it before building any view.
The summary:

**Velden Linen Forest.** Warm linen page, deep forest ink, one terracotta accent. Surfaces are
*lighter* than the background (paper on linen), which inverts the usual dark-app habit. Accent is
reserved for primary actions and moments of emphasis. Interaction states move lightness only, never
hue or chroma.

Type is Instrument Sans for chrome, Instrument Serif for prose and identity, IBM Plex Mono for
numerals. The transcript in the History reader is set in the serif at reading size, because a
dictation app's output is writing and should look like it.

**Surfaces:**

- **Capture overlay.** 360x88 pill, bottom-centre of the display containing the cursor. Canvas
  waveform at 60fps. Four states. The one thing seen daily, so it gets the most care.
- **Tray.** Three icon states, a working context menu (section 5.3).
- **Main window.** Frameless, custom title bar, four routes behind a slim rail: Dictate, History,
  Models, Settings. Plus a `Ctrl+K` command palette, which is nearly free once the tray menu
  actions are already enumerated.
- **First run.** Three skippable, non-blocking steps: microphone (with a live level meter so the
  permission visibly worked), engine (local download or paste an OpenRouter key), hotkey (record a
  chord, verify it registers). Ends with one line: "Hold Ctrl+Space anywhere and speak."

---

## 7. Verification

### 7.1 Playwright harness

`_electron.launch` needs a built main entry, so e2e always runs after `electron-vite build`. Hence
`"test:e2e": "electron-vite build && playwright test"`.

> **Landmine, already diagnosed. Do not rediscover this.**
>
> VS Code's extension host exports `ELECTRON_RUN_AS_NODE=1` into every terminal it spawns. Inherit
> it and `electron.exe` behaves as plain Node, rejecting Playwright's Chromium switch with
> `bad option: --remote-debugging-port=0`. It surfaces only as `Error: Process failed to launch!`,
> which looks exactly like a version incompatibility and is not. Reproduced on Electron 39, 41 and
> 43; invisible from a normal terminal. **The harness must strip the variable.**

```ts
export async function launchApp(overrides: Record<string, string> = {}): Promise<Harness> {
  const consoleErrors: string[] = []

  // VS Code leaks ELECTRON_RUN_AS_NODE=1, which turns electron.exe into plain
  // Node and makes the launch fail opaquely. See the note above.
  const { ELECTRON_RUN_AS_NODE: _drop, ...parentEnv } = process.env

  const app = await electron.launch({
    args: ['out/main/index.cjs'],
    env: {
      ...(parentEnv as Record<string, string>),
      STRUQ_VOICE_E2E: '1',          // no hook, no autostart, no first-run
      STRUQ_VOICE_ENGINE: 'mock',
      STRUQ_VOICE_USERDATA: /* fresh temp dir per test */ '',
      ...overrides,
    },
  })
  const window = await app.firstWindow()
  window.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  window.on('pageerror', (e) => consoleErrors.push(e.message))
  return { app, window, consoleErrors, close: () => app.close() }
}
```

| Spec | Asserts |
|---|---|
| `boot.spec.ts` | Launches, first window within 10s, correct title, **zero console errors**, `app.isReady()`, screenshot captured. |
| `overlay.spec.ts` | Driving the session via `app.evaluate()` creates a second window that is `focusable:false`, `skipTaskbar:true`, `alwaysOnTop:true`; shows on start, hides on stop. |
| `settings.spec.ts` | Every route renders clean; a changed setting survives relaunch. |
| `transcribe.spec.ts` | Mock engine: start, feed fixture PCM, stop, expected text, history row written, reaches `delivering`. |
| `tray.spec.ts` | Tray exists, context menu has the expected item ids. |
| `a11y.spec.ts` | Keyboard reaches every control; focus ring visible; `prefers-reduced-motion` removes motion without breaking layout. |

**Every spec ends with `expect(consoleErrors).toEqual([])`.** Electron emits no baseline console
errors on a clean boot, so this assertion is correct as written. Do not soften it to an allowlist
unless a specific, understood entry forces it. This gate is what catches the breakage that
"it looks fine" misses.

**Environment hooks**, added in Phase 0 so the tests can exist from day one:

- `STRUQ_VOICE_E2E=1`: no keyboard hook, no autostart, no first-run, no download prompts.
- `STRUQ_VOICE_ENGINE=mock`: force the mock engine.
- `STRUQ_VOICE_USERDATA=<path>`: `app.setPath('userData')` before `whenReady()`, so tests never
  touch the real profile.

### 7.2 Unit tests

Vitest over the pure logic where bugs are cheap to catch and expensive to find: `text-cleanup.ts`,
`wav.ts`, the state machine transition table, router fallback and timeout, settings migration.

### 7.3 Manual checklist

Not automatable, and exactly where this app breaks. Run before every release.

- [ ] Hold hotkey in Notepad, speak, release. Text at the caret.
- [ ] Same in Chrome, VS Code, Slack, Windows Terminal, an Office app.
- [ ] Same while the main window is open but unfocused.
- [ ] Main window focused: inserts in-app, does **not** synthesise a paste.
- [ ] **Ten consecutive captures; the hook still fires on the tenth.** (uiohook/getUserMedia.)
- [ ] Typing normally while idle: zero perceptible input lag.
- [ ] `Escape` mid-capture: nothing pasted, nothing in history.
- [ ] Clipboard contents restored after a paste.
- [ ] Unplug the mic mid-capture: clear error, no crash, recovers on replug.
- [ ] Kill the network on the cloud engine: clear error, offers local.
- [ ] Second launch focuses the existing window.
- [ ] Overlay on the correct monitor in a multi-display setup.
- [ ] `prefers-reduced-motion` removes motion without breaking layout.
- [ ] Overlay holds 60fps while Parakeet runs.

---

## 8. Phases

Each ends green before the next begins: builds, `pnpm typecheck` passes, `pnpm test:e2e` passes
with zero console errors, committed as its own commit.

### Phase 0: skeleton
An empty Electron app that boots via `pnpm dev`, shows a window styled from `theme.css`, and passes
`boot.spec.ts`. Repo bootstrap, `electron.vite.config.ts` with three preload and three renderer
entries, `src/main/index.ts` (single instance lock, `STRUQ_VOICE_USERDATA`, `Menu.setApplicationMenu(null)`),
`src/shared/{ipc,result}.ts`, Tailwind v4 + fonts + `theme.css`, Playwright harness, ESLint,
Prettier, `docs/ARCHITECTURE.md`.
**No features. Get the skeleton green first.**

### Phase 1: surfaces
Overlay window (ported), recorder window (hidden, no audio), tray, the capture state machine with a
`simulate()` path so it runs without a microphone, both hotkeys, `@electron/rebuild` in
`postinstall`. Specs: `overlay`, `tray`.
**Done when** the hotkey drives the overlay through every state, the tray reflects it, and nothing
ever steals focus.

### Phase 2: audio
Warm `getUserMedia`, the `pcm-collector` worklet, ring buffer, pre-roll, 60Hz levels, Int16
transfer, `wav.ts`, silence trim, device selection, stream watchdog.
**Verify the uiohook hypothesis here: ten cycles, main window focused.**
**Done when** a capture produces a WAV that plays back correctly and the overlay waveform tracks
your voice.

### Phase 3: engines, cloud first
Engine interface, router, mock. OpenRouter plus `safeStorage`. Drizzle schema, migrations, history
store with FTS5. Spec: `transcribe`.
Cloud first because it is a pure `fetch` and closes the full loop in one phase, so the local
engines drop in behind a proven interface.
**Done when** hold, speak, release puts text on the clipboard.

### Phase 4: paste
The delivery chain from 5.2: clipboard save, `keyTap` primary, PowerShell fallback, restore, and
the "our window is focused" branch. Work the paste rows of the manual checklist.
**Done when** dictation works in Notepad, Chrome, VS Code, Slack and Windows Terminal.

### Phase 5: local engines
Catalog, downloader (resume + SHA-256), installer. Parakeet with background warmup. whisper.cpp
sidecar with runtime download and CUDA detection. Models UI. Record measured RTF per engine.
**Done when** a cold machine downloads Parakeet v3, warms it, and transcribes 5s in under 400ms of
inference.

### Phase 6: interface
shadcn primitives added **and fully restyled** to the Velden system. Canvas waveform at 60fps under
inference load. All four routes built properly. Command palette, first-run, empty states, error
states, reduced motion. Text post-processing and dictionary UI.
**Done when** the DESIGN_SYSTEM section 10 self-review passes on every view.

### Phase 7: ship
NSIS one-click per-user installer. Autostart hidden to tray. Icons. `MODELS.md`,
`TROUBLESHOOTING.md`, `README.md`. Full e2e green **against the packaged build**, not just dev.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **uiohook + getUserMedia** breaks PTT | High. Core interaction. | The hidden recorder window is the structural fix, but it is **unproven**. Verify in Phase 2 before building on it. Fallbacks: main-process capture via a native binding, or an `ffmpeg -f dshow` sidecar. |
| Native rebuild breaks on Electron upgrade | Medium. Blocks builds. | Pin Electron 39. `@electron/rebuild` in `postinstall`. Every native module degrades rather than preventing boot. |
| Windows UIPI blocks paste into elevated windows | Medium. Silent in admin terminals. | Text is on the clipboard first; overlay says "Copied, press Ctrl+V". Documented. |
| 660MB first download | Medium. First impression. | Background, app usable throughout, OpenRouter available immediately as the zero-setup path, resumable. |
| Overlay blocked by an always-on-top policy | Low. | Already handled in the ported code: try/catch plus `Notification` fallback. |
| Clipboard restore races the target app | Low, annoying. | 400ms default, configurable, and the whole restore is optional. |
| shadcn default skin ships by accident | **High for the stated goal.** | Section 9 of DESIGN_SYSTEM is binding. A generated component that has not been restyled is not finished work, and the self-review catches it. |
| `ELECTRON_RUN_AS_NODE` breaks e2e | Low, but an hour to diagnose. | Harness strips it. Documented in 7.1. |
| pnpm skips native postinstalls | Low. | `allowBuilds` in `pnpm-workspace.yaml`. |

---

## 10. Done

1. Holding `Ctrl+Space` anywhere in Windows, speaking, and releasing puts accurate text at the
   caret in the app that was focused, in under one second for a short utterance.
2. Tray-resident, starts with Windows, never in the way.
3. Parakeet v3 local by default with no network access; OpenRouter as explicit opt-in.
4. `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` all pass, e2e asserting **zero console errors**.
5. The manual checklist in 7.3 passes.
6. The DESIGN_SYSTEM self-review passes on every view.

---

## 11. Reference index

Port from `C:\Users\Royhe\Documents\Coding\Projects\1Personal\StruqMain\StruqADE`:

| What | Source |
|---|---|
| Overlay lifecycle, focus/blur, Notification fallback | `apps/desktop/src/main/voice-overlay.ts` |
| Clipboard, paste synthesis, focused-window branch | `apps/desktop/src/main/voice-service.ts:104-189` |
| `safeStorage` key read/write | `apps/desktop/src/main/voice-service.ts:29-67` |
| OpenRouter STT call, retry, fallback model | `apps/desktop/src/main/voice-service.ts:199-365` |
| `globalShortcut` registration and cleanup | `apps/desktop/src/main/index.ts:200-233` |
| Frameless window, bounds persistence, title bar IPC | `apps/desktop/src/main/index.ts:74-151` |
| Native rebuild script | `scripts/rebuild-native-modules.mjs` |
| `Result<T>`, `ok`, `fail` | `packages/ipc/src/index.ts` |

**StruqADE has no tray.** Section 5.3 specifies it from scratch.

External:

- [OpenRouter STT](https://openrouter.ai/docs/guides/overview/multimodal/stt)
- [sherpa-onnx Node addon](https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/README.md)
- [Parakeet TDT models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html)
- [uiohook-napi](https://github.com/SnosMe/uiohook-napi)
- [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases)
- [Playwright Electron](https://playwright.dev/docs/api/class-electron)
- [Tailwind v4 theme](https://tailwindcss.com/docs/theme)
- [shadcn/ui Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4)
