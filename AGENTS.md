# Struq Voice: AGENTS.md

Read this file completely before doing anything in this repo. It is the
source of truth for what this project is, how it is built, how to gate work,
and what must never be broken. Supplementary docs live in `docs/`; the
skills in `.agents/skills/` and `.claude/skills/` encode the deep knowledge
as invokable skills.

---

## 1. What this project is

**Struq Voice** is a tray-resident Windows dictation app. Hold a key
anywhere in Windows, speak, release, and the transcript appears in whatever
field you were focused on.

Target: **Windows 10 and 11, 64-bit.** Electron 39 pinned, React 19, Tailwind v4,
TypeScript strict.

The one design document that matters more than any other is
`docs/DESIGN_SYSTEM.md` (Evergreen and Ember). Every UI decision in this
repo is bound by it. If you build a view that fights it, you have a bug.

## 2. The product loop

1. User holds `Ctrl+Space` (configurable). A low-level hook (uiohook-napi)
   detects key-down and key-up; `globalShortcut` cannot, so PTT needs a hook.
2. A hidden **recorder window** owns a permanently warm microphone
   (`getUserMedia` + an AudioWorklet). Captures begin by appending to a
   buffer, so there is no 100-300ms mic-open latency in the hot path.
3. Audio is 16kHz mono Int16, transferred to main as an `ArrayBuffer`, cut
   into a WAV in memory, transcribed by an engine, cleaned up, and pasted
   into the focused window via synthesized `Ctrl+V`.
4. The overlay (a `focusable: false` window) shows a pill with a live
   waveform. Because it can never take focus, the foreground window never
   changes and the paste lands in the right app.

## 3. Architecture at a glance

```
MAIN PROCESS            RECORDER (hidden)      OVERLAY (never focused)
lifecycle · tray        warm getUserMedia       capture pill, live waveform
hotkeys · session       AudioWorklet -> PCM
engines · paste · db    -> main

MEETING WINDOW (hidden, on demand)   MEETING WORKER (utilityProcess)
loopback + mic worklets              VAD -> ASR -> speaker clustering
opus archive -> main                 -> main (finished segments)
                                                       MAIN WINDOW (on demand)
                                                       Dictate · Meetings · History · Models · Settings
```

Key files:

| Area | File |
|---|---|
| Boot, wiring, single instance | `src/main/index.ts` |
| Capture state machine | `src/main/session/capture-session.ts` |
| Meeting state machine | `src/main/meeting/meeting-session.ts` |
| Hotkeys (PTT hook, toggle, meeting, Escape) | `src/main/hotkeys/{index,ptt-hook,toggle-shortcut,meeting-shortcut}.ts` |
| Audio pipeline (recorder renderer) | `src/renderer/recorder/{recorder.ts,audio.ts,pcm-collector.worklet.js}` |
| Meeting audio pipeline (renderer) | `src/renderer/meeting/{meeting.ts,audio.ts,meeting-collector.worklet.js}` |
| Meeting transcription worker | `src/main/meeting/worker/` |
| Meeting orchestration (session, assets, archive, ipc) | `src/main/meeting/` |
| Engines: mock / parakeet / whisper / openrouter | `src/main/engines/` |
| Model catalog + downloader + runtime | `src/main/models/` + `src/shared/models.ts` |
| Meeting support assets (VAD, embedding, segmentation) | `src/shared/meeting-assets.ts` |
| Paste delivery | `src/main/platform/win32/paste.ts` |
| History + meetings (SQLite + FTS5) | `src/main/db/` |
| Settings + secrets | `src/main/store/` + `src/shared/settings.ts` |
| Text post-processing | `src/main/post/text-cleanup.ts` |
| IPC channels (SINGLE SOURCE) | `src/shared/ipc.ts` + `src/preload/*.ts` |
| Tray | `src/main/tray.ts` |
| Windows | `src/main/windows/{main,overlay,recorder,meeting}-window.ts` |
| Main window UI | `src/renderer/main/` |

## 4. Boundaries (enforced by lint, never violated)

- The renderer never imports from `src/main/`.
- `src/shared/` has no side effects and no Electron imports. It must run in
  any process (main, preload, renderer, tests).
- Every IPC channel is declared in `src/shared/ipc.ts` and nowhere else.
- Every window: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. No exceptions.
- Sandboxed preloads cannot load shared modules, so main serializes the
  channel names from `PRELOAD_CHANNELS` (in `src/shared/ipc.ts`) into the
  window's `additionalArguments`. Each preload reads them from argv.

## 5. The capture state machine

Single authority in `capture-session.ts`. Tray, overlay and main window all
render from broadcasts of it. Nothing else owns capture state.

```
idle ──arm──▶ arming ──ready──▶ listening ──stop──▶ transcribing ──ok──▶ delivering
  ▲             │                   │                    │                    │
  │             └──fail─────────────┴───cancel───────────┘                    │
  └────────── error ◀───────────────┴────────fail────────┘                    │
  └──────────────────────── done (auto after 900ms) ◀─────────────────────────┘
```

- `cancel` is Escape, registered only for the duration of a capture.
- Captures under `minCaptureMs` (350ms) are discarded silently.
- A `maxCaptureMs` (300s) watchdog force-stops a stuck-key capture.

## 5b. The meeting state machine

Single authority in `meeting-session.ts`, in the same shape as the capture
session: a factory taking injected dependencies, returning commands and a
`subscribe`. Tray and main window render from broadcasts of it.

```
idle ──start──▶ starting ──lanes live──▶ recording ──stop──▶ finalizing ──▶ idle
  ▲                │                        │  ▲                            │
  │                └──fail──────────────────┴──┘pause/resume──────────────┘
  └────────── error ◀────────────────── worker failure / 8s lane timeout ──┘
```

- Meetings are refused up front when the database, the support assets or the
  engine are unavailable; the renderer turns each refusal into its own copy.
- The hidden meeting window is created on start and destroyed on stop; the
  `struq-meeting` utilityProcess is forked on start, drained on stop, killed.
- The microphone lane is always the speaker `me`; only the system lane is
  clustered. Dictation always wins: the capture session's state is mirrored
  into `setDictationActive`, which yields the worker.

## 6. Engines

Interface in `src/main/engines/types.ts`. Router cascades primary to
fallback on not-ready/error/timeout. **Never cascade local to cloud without
explicit opt-in** (that sends audio off the machine).

| Engine | Kind | Notes |
|---|---|---|
| `parakeet` | local | Default. sherpa-onnx-node, background warmup |
| `whisper-cpp` | local | Sidecar `whisper-cli.exe`, GPU capable |
| `openrouter` | cloud | Needs API key, cost recorded per transcription |
| `mock` | test | Deterministic fake transcript |

## 7. Verification gates (the ONLY acceptable definition of "done")

Every slice must pass these before commit:

```bash
pnpm typecheck    # tsc -p tsconfig.{node,web,e2e}.json
pnpm lint         # eslint . (strictTypeChecked)
pnpm test         # vitest unit tests
```

`pnpm test:e2e` builds and runs Playwright. **Do not run it unprompted.**
The suite is headless and slow, and `hook.spec.ts` needs a real microphone
and real OS focus, so it is flaky in isolation. The user runs e2e
themselves. Do not "fix" the e2e specs without being asked.

A boot smoke (launch hidden, confirm it stays healthy) is a reasonable
substitute when you want confidence without the full suite:

```bash
pnpm smoke:boot
```

The script uses isolated user data, hides the window, kills only the process
tree it started, and removes its temporary files. Electron 39 for Windows does
not accept a `--headless` command-line switch.

## 8. Environment switches

| Env var | Effect |
|---|---|
| `STRUQ_VOICE_E2E=1` | No keyboard hook, no autostart, no first-run; simulated audio source |
| `STRUQ_VOICE_HOOK_TEST=1` | Like production but with the test hook; real mic + real hook |
| `STRUQ_VOICE_USERDATA=<path>` | Point userData elsewhere (tests use fresh temp dirs) |
| `STRUQ_VOICE_ENGINE=<id>` | Force a specific engine, overrides settings |
| `STRUQ_VOICE_START_HIDDEN=0` | Show the main window even at login |
| `STRUQ_VOICE_PACKAGED=<exe>` | e2e harness targets the packaged build instead of dev output |

## 9. Native modules

`better-sqlite3`, `uiohook-napi`, `sherpa-onnx-node` all target Electron 39.
`scripts/rebuild-native-modules.mjs` runs on `postinstall`. Every native
module degrades rather than preventing boot: history unavailable, PTT falls
back to toggle, Parakeet reports "runtime not installed". Do not upgrade
Electron without the user's explicit request.

## 10. Coding rules (non-negotiable)

- **Never use em dashes (U+2014), en dashes (U+2013) or horizontal bars
  (U+2015) anywhere**: code, comments, docs, commit messages, chat. Use
  commas, colons, parentheses, or two sentences. This is the single most
  recognisable "AI wrote this" tell; it is banned repo-wide.
- Do not add comments unless they carry real information. Header doc
  comments in the existing files are the house style; follow them.
- Follow existing patterns. When a file already uses dependency injection
  for testability (engines, paste, models), new code should too.
- Never commit secrets. Never log or cross IPC with API keys.
- The renderer never imports from `src/main/`.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.

## 11. Commit conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`,
  `chore:`.
- One concern per commit. Commit only when the user asks, or when following
  an explicit instruction to commit slices.
- Before committing, check `git status`, `git diff`, `git log --oneline -5`.

## 12. Releasing and updates

`pnpm release:cut patch` then `pnpm ship`. Nothing else is typed: every step
after the cut reads the version from `package.json`.

Struq Voice ships without a code signing certificate, so an update channel
would otherwise mean "execute whatever the feed serves". Every artifact
carries an Ed25519 signature over `<sha512>|<version>`, verified in
`src/main/updater.ts` against the public key in `src/shared/release-key.ts`
before anything installs. A failed check aborts rather than warns.

- The private key lives at `~/.struq/struq-voice-release-private.pem`, never
  in the repo. Rotating it stops every installed copy from updating.
- The version is in the signed message so a genuinely signed older build
  cannot be replayed as a downgrade.
- `verify-release.mjs` deliberately shares no code with `sign-release.mjs`.
  A verifier built on the signer's helpers only proves they agree with
  themselves.
- Builds go to `%TEMP%/struq-voice-release`, because electron-builder's
  rename step hits EPERM under `Documents`.

Full detail, including the manual gate check, in `docs/RELEASING.md`.

## 13. Docs

- `docs/IMPLEMENTATION_PLAN.md` - the full build plan (7 phases). The
  definitive reference for intended behavior.
- `docs/DESIGN_SYSTEM.md` - Evergreen and Ember, binding.
- `docs/FEATURES.md` - what is built, current state, known gaps.
- `docs/MODELS.md` - engines, catalog, download pipeline.
- `docs/TROUBLESHOOTING.md` - known failures and fixes.
- `docs/ARCHITECTURE.md` - process/window model and boundaries.
- `docs/RELEASING.md` - cut, sign, verify, publish, and why updates are signed.
- `README.md` - product-facing summary.

## 14. Skills

`src/../.agents/skills/` (and the mirrored `.claude/skills/`) hold invokable
skills for this repo:

- `project-context` - load the full picture before starting any task.
- `verification-gates` - the exact commands and rules for gating work.
- `ipc-architecture` - how to add an IPC channel end to end.
- `native-modules` - native module handling and degradation paths.
- `capture-session` - the state machine, hotkeys and audio pipeline.
- `meeting-pipeline` - the meeting state machine, loopback capture and worker.

Invoke the relevant skill when a task matches its description.

## 15. Internationalization

- Hand-rolled typed catalog in `src/shared/i18n/`. No external i18n framework.
- Two independent axes: UI language (`settings.locale`) and Speech language (`settings.speechLanguage`). Never derive one from the other.
- **Resolution algorithm**: Main resolves at boot via `app.getPreferredSystemLanguages()`, normalizes to BCP47 canonical casing, applies the alias table (`zh-CN`/`zh-SG` -> `zh-Hans`, `zh-TW`/`zh-HK` -> `zh-Hant`, `pt-BR` -> `pt-BR`, `pt-PT` -> `pt-PT`, `no`/`nn`/`nb` -> `nb`, `sr-Latn` -> `sr-Latn`, `en-*` -> `en`, `he`/`iw` -> `he`, `id`/`in` -> `id`, `fil`/`tl` -> `fil`), checks supported list, and falls back to `en`.
- **Handoff**: Main passes `--struq-locale=<tag>` and `--struq-dir=<ltr|rtl>` in window `additionalArguments` so preloads and React initialize without an English flash.
- **IPC Rule**: Main process NEVER sends translated strings to the renderer for display. Main sends machine-readable error/state codes with typed parameters; renderer translates using `t()`. Main translates only native OS chrome (tray menu, OS notifications, native dialog titles).
- **RTL and Layout**: Directional Tailwind utilities use logical properties (`ps-`, `pe-`, `ms-`, `me-`, `text-start`). CSS font stacks in `theme.css` include Windows script fallback chains for CJK, Indic, and Thai.
