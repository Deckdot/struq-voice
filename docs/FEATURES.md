# Struq Voice: features and current state

What is built, what is current, and what is still open. This is the
project-status index any agent or human should read first, after AGENTS.md.

## Status: shipped

The original seven-phase build plan is fully implemented, and meetings,
the dictionary and internationalization landed after it. All gates green:
`pnpm typecheck`, `pnpm lint`, `pnpm test` and the dev e2e suite (headless,
green when run as `pnpm test:e2e`). The risk-weighted test policy lives in
`docs/TESTING.md`.

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
  error`) with 350ms min capture and 300s max capture.

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
- Every catalog file carries a real hash, vocabularies included, so a
  truncated `tokens.txt` cannot pass as installed and fail at first decode.
  A test rejects an all-zero placeholder anywhere in the catalog.
- Whisper runtime zip download (sha256 verify, extract only `whisper-cli.exe`).
- Import an existing local model directory (copies then verifies).
- Measured realtime factor per engine, computed from real History rows.
- The Whisper model picker in Settings separates what is on this computer
  from what still has to be downloaded, and says so when the selected model
  is not there. Listing all thirty builds identically made switching to one
  that had never been downloaded look like a normal choice, and it failed on
  the next capture instead.

### Paste and delivery
- Target decision (our window focused -> renderer inserts, else clipboard +
  synthesized Ctrl+V).
- `uIOhook.keyTap` primary (~2ms) with a PowerShell SendKeys fallback.
- The clipboard write settles before the keystroke is synthesized, and any
  modifier the user is still physically holding is released first. Both were
  silent causes of a dictation that never landed.
- Optional clipboard save/restore with configurable delay. Text and images
  both round trip, so delivering a transcript does not cost the user a copied
  screenshot. A format that cannot be restored (a file selection) is still
  written over: losing the dictation is the worse trade, and refusing to
  write used to lose it while reporting success.
- The overlay reports the outcome honestly, in marks rather than words: a
  check when the transcript reached the target app, a clipboard glyph when it
  reached the clipboard but not the field.

### Data
- History: better-sqlite3 + Drizzle + FTS5 search, virtualized reader,
  copy/delete, engine/cost metadata.
- Settings: zod-validated JSON, live-updating via IPC, autostart flag.
- Secrets: OpenRouter key in safeStorage (DPAPI), masked in Settings,
  replace/remove actions, env fallback.

### Post-processing
- Trim/collapse whitespace (always on), filler removal, trailing punctuation, and a standalone Dictionary matching engine supporting case sensitivity, whole words, rule toggling, and deletion; pure functions with unit tests.

### Meetings
- `Ctrl+Shift+M` anywhere in Windows starts and stops a meeting: system
  audio (any app that plays sound) plus your microphone, transcribed live
  with speaker attribution.
- Hidden meeting window owns Windows loopback capture
  (`getDisplayMedia` with `audio: "loopback"`, driven from main via
  `executeJavaScript` because a hotkey has no user activation) and the opus
  archive; created on demand, destroyed on stop.
- ASR runs in a `utilityProcess` (`struq-meeting`), spawned per meeting and
  killed on stop, so the synchronous sherpa decode never stalls main.
- Silero VAD cuts utterances per lane; silence is never decoded. The mic
  lane is always "You"; the system lane is attributed by incremental speaker
  clustering with a CAM++ embedding model, refined per long turn by a
  pyannote segmentation model.
- Speaker clustering represents a voice by its recent utterances rather than
  by one running average, embeds only the speech inside an utterance, and
  refuses to let anything under `minSpeakerAudioMs` (3s by default) register
  a new speaker: a CAM++ embedding scores about 0.15 against its own voice at
  one second and 0.89 at eight, so short remarks carry no identity. Speakers
  that turn out to be one voice are merged, and main rewrites the segments it
  already stored.
- Live transcript view (virtualized, pinned to live with jump-to-live),
  searchable library, renameable speakers, Markdown/Text/SRT export, playable
  recording revealed in Explorer.
- Dictation always wins: main yields the worker while a capture is live, and
  the worker's queue is hard-capped with honest gap markers.
- Support models (VAD, embedding, segmentation) install once from the
  Meetings page through the resumable downloader, kept out of the Models
  view.
- A meeting that never really started or never really finished is filed
  `interrupted`, never `complete`. That covers a stop landing mid-start (the
  start carries a generation token and unwinds only what it created, rather
  than rebuilding a window and worker nobody owns), an archive that errored,
  and a capture renderer that died. The row records which language the
  meeting was decoded under; null means the decoder auto-detected.
- Losing the capture window mid-meeting ends the meeting instead of leaving
  it recording forever: main watches `render-process-gone`, because the
  lane-live timer is cleared once a lane goes live and nothing else would
  notice. Whatever was recorded before the death is kept.

### Onboarding and hardware
- Machine profiling: cores and memory from Node `os`, GPU vendor from
  `app.getGPUInfo("basic")`, CUDA runtime from the whisper.cpp DLL probe.
  No subprocess calls, and every probe degrades to the unknown profile
  rather than blocking boot (`src/shared/hardware.ts`,
  `src/main/hardware/detect.ts`).
- One model recommended per machine, named with the hardware that chose it:
  Parakeet v3 for a balanced or capable PC, whisper base q5_1 for a light
  one. Pure and unit tested.
- First run is a full-window flow with five steps: microphone (arrives
  satisfied, live meter), speech language (preselected from the OS preferred
  languages, so the common case is one confirming click), hotkey (defaults
  already registered), engine (the download starts on mount, not on arrival),
  and a real capture the user performs themselves. Skipping is as cheap as
  continuing and still leaves a working app.
- The speech language step only ever writes over the `auto` default, never
  over a language already chosen, so a re-run cannot silently change it. It
  writes `speechLanguage` and never `locale`: the two are independent axes.
- Completion lives in the settings schema (`onboarding.completed`), so main
  can gate on it and clearing the web cache cannot replay it. An install that
  predates the block and already has a real engine is treated as complete.
  Skipped entirely under `STRUQ_VOICE_E2E=1`.

### Interface
- Application shell: branded custom title bar, left navigation rail with
  Dictate, Meetings, History, Dictionary, and Models at the top, Settings pinned at the bottom,
  and a flexible content region. Ctrl+1..6 jumps between
  pages, Ctrl+F or the title-bar search button opens global search (input
  autofocused, live transcript results, Enter lands in History pre-filtered
  and scrolled to the picked record), Esc closes
  any overlay.
  First paint reveals via a two-sheet curtain with trailing soft accent band.
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
  cards, a status panel with the fix offered inline, and an activity
  chart with a weighted draw-in sweep.
- History is a virtualized list grouped by day (Today, Yesterday, then
  weekday + date), with a search field, copy and a two-step delete per
  row. Selecting a misheard phrase in an expanded transcript opens a
  one-step rule popover: the selection is the "heard as" side, only the
  replacement is typed, and an existing rule for the same phrase is
  updated in place instead of duplicated. Roving tabindex, Enter to copy,
  Delete to remove. Highly optimized
  scroll performance with memoized grouping and static Intl formatters.
- Dictionary is a dedicated view for correction rules: add/edit rules,
  matchCase and wholeWord toggles, rule enable/disable switches, a live
  "Try It" sandbox with highlighted match previews and input/output side-by-side,
  starter suggestions, search, sorting, and native JSON import/export dialogs.
- Models leads with the current selection and three recommendations based
  on detected hardware. Tiny, Base, Small, Medium, and Large each show the
  three strongest variants first, with every remaining variant available
  on demand. NVIDIA and OpenAI marks identify the model provider. A PC specs
  dialog shows the detected CPU, memory, graphics, CUDA state, and workload
  profile.
- Settings is six horizontal tabs: General, Capture, Transcription,
  Delivery, Text, Appearance. Each is a SettingsGroup of related
  rows. Advanced values (min/max capture, pre-roll, restore delay,
  live transcript interval) live behind a Disclosure in their
  category. The OpenRouter key field and the model picker live in their category.
  The key field carries an explicit Paste button, and every editable field in
  the app has a right-click Cut/Copy/Paste/Select All menu, so a key can be
  pasted even when the Ctrl+V accelerator does not reach the window.
  Text settings include filler and punctuation toggles and a link to the Dictionary tab.
  The voice service picker, the backup service picker, and the theme picker all
  apply immediately. Capture includes a live level meter under the selected
  microphone so input can be tested without starting a transcription.
- The capture pill is the floating overlay window. Five states
  with object continuity on the same canvas: arming, listening,
  transcribing, delivering, error. The waveform decays into a thin
  processing line during transcribing, so the user sees the audio
  being worked on without a generic spinner. Listening uses a green
  animated bouncing-ball mark and waveform. Delivery resolves to a drawn
  check only. The pill carries no status copy at all: it sits over whatever
  the user is working in, for under a second, where instructions read as
  noise rather than help. Only an error names its cause.
- Theme is System, Light, or Dark. System follows the Windows setting
  live. Both themes are designed: light uses warm porcelain and evergreen,
  while dark uses opaque graphite surfaces and terracotta emphasis. Verdigris
  is reserved for recording and genuine success states.
- Views built against Evergreen and Ember
  (`docs/DESIGN_SYSTEM.md`).

### Internationalization
- Hand-rolled typed catalog in `src/shared/i18n/` with zero side effects and zero Electron imports.
- Dual-axis model: independent UI language (`settings.locale`) and speech language (`settings.speechLanguage`).
- Boot-time Windows preferred system language resolution (`app.getPreferredSystemLanguages()`) with canonical BCP47 tag normalization and alias mapping.
- Handoff via window `additionalArguments` (`--struq-locale` and `--struq-dir`) to prevent flash of English.
- Strict IPC discipline: main process translates native OS chrome (tray, notifications, dialogs) while sending machine-readable codes to renderer for client-side translation via `t()`.
- RTL layout support with Tailwind v4 logical properties (`ps-`, `pe-`, `ms-`, `me-`, `text-start`) and per-script font fallback stacks in `theme.css`.
- Cached `Intl.DateTimeFormat` and `Intl.NumberFormat` factories to maintain virtualized list performance.
- Speech Language axis with per-speech-language filler word removal in text cleanup (NFC normalized, Unicode case-folded). A language with no filler table removes nothing rather than falling back to English: the English list contains "er", which is the verb "is" in Danish and Norwegian. Elongated spellings ("ummm") are matched, and a filler removed from the start of a sentence hands its capital to the word that takes its place.

### Platform
- NSIS one-click per-user installer, app icon, tray icons.
- Autostart with Windows, hidden to tray; close hides rather than quits.
- Tray: three icon states with live animation for dictation and meetings,
  tooltip with engine/state, recent transcripts, capture toggle, engine radio
  group, pause, quit. Starting a meeting also opens the non-focusable floating
  feedback panel with a timer and live system-audio and microphone meters.

## Known gaps and deferred work

- `e2e/settings.spec.ts` and `e2e/a11y.spec.ts` are not written. The user
  runs e2e and adds these when they want them.
- The pre-release manual checklist in `docs/RELEASING.md` is inherently
  manual and is run by hand before a release.
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
