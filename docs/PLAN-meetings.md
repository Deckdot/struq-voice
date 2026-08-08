# Implementation plan: Meetings (system audio capture, long-form transcription, speaker identification)

Hand-off document. Everything below was read against the working tree at
`main` (HEAD `64abbae`, v0.3.1). File paths, exported symbols, native module
APIs, Electron typings and model hashes are verified against the actual
sources in this repo and against the Hugging Face API, not assumed. Where a
number could not be verified it is called out explicitly and a way to derive
it is given.

Work the sections in order. WS1 through WS5 are the machine and must land
before the UI in WS6 has anything to render.

**House rules that apply to every line you write here:**

- No em dashes (U+2014), en dashes (U+2013) or horizontal bars (U+2015).
  Anywhere: code, comments, docs, commit messages. Use commas, colons,
  parentheses, or two sentences.
- Comments only when they carry information. Match the header doc-comment
  style already in each file.
- The renderer never imports from `src/main/`.
- Every IPC channel is declared in `src/shared/ipc.ts` and nowhere else.
- `src/shared/` has no side effects and no Electron imports.
- Every window: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`.
- TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Dependency injection for anything that touches the filesystem, the network
  or a native module, so it can be unit tested. The engines, models and paste
  modules already do this; follow them.
- Gate with `pnpm typecheck && pnpm lint && pnpm test`. Do **not** run
  `pnpm test:e2e` unprompted.

---

## Table of contents

- [0. The shape of the thing](#0-the-shape-of-the-thing)
- [1. Architecture decisions and why](#1-architecture-decisions-and-why)
- [WS1: shared contracts](#ws1-shared-contracts)
- [WS2: audio capture](#ws2-audio-capture)
- [WS3: the transcription worker](#ws3-the-transcription-worker)
- [WS4: main-process orchestration](#ws4-main-process-orchestration)
- [WS5: persistence](#ws5-persistence)
- [WS6: the interface](#ws6-the-interface)
- [WS7: export](#ws7-export)
- [Test plan](#test-plan)
- [Performance budget and how to verify it](#performance-budget-and-how-to-verify-it)
- [Deliberately not in scope](#deliberately-not-in-scope)
- [Final gate checklist](#final-gate-checklist)

---

# 0. The shape of the thing

## What the user gets

Press `Ctrl+Shift+M` anywhere in Windows, or click Start in the new Meetings
page, or use the tray. Struq Voice begins recording whatever the machine is
playing (Teams, Zoom, Meet, Discord, a browser tab, anything) plus your own
microphone. A live transcript builds as the meeting runs, with each line
attributed to a speaker. Press the key again to stop. The meeting lands in a
searchable list with its audio, its transcript, and renameable speakers.

It has to survive three hours without the machine noticing, and it must never
slow down dictation, which remains the product's hot path.

## The pipeline, end to end

```
  Windows audio engine                     microphone
        |                                        |
        | WASAPI loopback                        | getUserMedia
        v                                        v
  +------------------------------------------------------------+
  |  MEETING WINDOW (hidden, created on demand, destroyed on    |
  |  stop). One AudioContext at 16 kHz.                         |
  |                                                            |
  |   loopback ---> meeting-collector worklet ---> 1s Int16     |
  |          \                                     batches      |
  |           \--> mix -----> MediaRecorder(opus) --> archive   |
  |           /                                                 |
  |   mic ----+----> meeting-collector worklet ---> 1s Int16    |
  +------------------------------------------------------------+
        |  ipcRenderer.send, no accumulation
        v
  +------------------------------------------------------------+
  |  MAIN PROCESS                                               |
  |  meeting-session.ts  (the one authority on meeting state)   |
  |  meeting-store.ts    (the only SQLite writer)               |
  |  archive-writer.ts   (appends opus chunks to disk)          |
  |  Forwards audio frames straight through. Holds no audio.    |
  +------------------------------------------------------------+
        |  utilityProcess.postMessage
        v
  +------------------------------------------------------------+
  |  MEETING WORKER (utilityProcess, spawned on start, killed   |
  |  on stop). Its own OS process, its own event loop.          |
  |                                                            |
  |   per lane:  Silero VAD  -> utterance queue -> ASR engine   |
  |                                     |                       |
  |   system lane only:  speaker embedding -> incremental       |
  |                      clustering -> speaker key              |
  +------------------------------------------------------------+
        |  postMessage: one finished segment at a time
        v
     main writes the row, pushes it to the renderer
```

Nothing in this pipeline grows with meeting length except rows in SQLite and
bytes in one opus file. That is the whole performance story, and section
[Performance budget](#performance-budget-and-how-to-verify-it) states the
numbers you must hold to.

---

# 1. Architecture decisions and why

Read this section before writing code. Every one of these is load-bearing and
several are non-obvious. Do not relitigate them.

## 1.1 The ASR runs in a `utilityProcess`, not in main

**This is the single most important decision in the plan.**

`sherpa-onnx-node`'s `recognizer.decode(stream)` is a **synchronous blocking
native call**. Look at `src/main/engines/parakeet.ts:289`: it runs on the main
thread and the whole function is synchronous behind a `Promise.resolve`. For
dictation that is fine, because a decode is a few hundred milliseconds once in
a while. For a meeting it is fatal: continuous decoding would stall the main
process, and with it the tray, the IPC, the settings store, the hotkey
dispatch and every window's message pump, for most of the meeting.

So meeting transcription runs in an Electron `utilityProcess`
(`electron.d.ts:14965`, available in the pinned Electron 39.8.10). That gives:

- A separate OS process with its own event loop and its own CPU time.
- Crash isolation. A segfault inside ONNX ends the meeting, not the app.
- Memory that is genuinely released: the process is killed on stop, so the
  second recognizer and the ONNX arenas go away rather than fragmenting main's
  heap for the rest of the session.

Cost: a second copy of the model in RAM while a meeting runs. That is the
correct trade and it is why the process is spawned per meeting rather than
kept warm.

`UtilityProcess.postMessage(message, transfer?: MessagePortMain[])` accepts a
transfer list of ports only, not ArrayBuffers, so audio frames are structured
cloned (copied). At 1 second of 16 kHz mono Int16 that is a 32 KB copy per
second per lane. Negligible. Do not try to be clever with SharedArrayBuffer.

## 1.2 A separate hidden window owns the meeting audio

Do **not** add loopback capture to the existing recorder window
(`src/renderer/recorder/`). That window owns the permanently warm dictation
microphone, and the whole product depends on it staying warm and on the global
keyboard hook it gates (`src/main/index.ts:627`, `maybeStartHotkeys`). A
`getDisplayMedia` call, a second AudioContext and a MediaRecorder in that
window put the hot path at risk for no benefit.

The meeting window is created when a meeting starts and destroyed when it
stops, so an idle app pays nothing for this feature.

## 1.3 The two lanes stay separate all the way through

System audio and microphone are captured, transcribed and attributed
separately. They are only ever mixed for the archive file.

- The microphone lane is you, by construction. It needs no diarization and
  gets the speaker key `me`. That is both free and more accurate than any
  clustering could be.
- The loopback lane is everyone else. Your own voice is not in it, because
  Windows loopback captures what the machine renders, and a conferencing app
  does not render your own microphone back to you. So the clustering problem
  is "who are the remote participants", which is the tractable version.

This halves the diarization work and removes the hardest case (telling you
apart from a remote speaker who sounds like you).

## 1.4 Voice activity detection, not fixed chunks

Fixed 30 second windows cut words in half and waste an enormous amount of
compute on silence. In a four-person meeting any one lane is silent most of
the time.

Use `sherpa-onnx-node`'s `Vad` (Silero) to cut each lane into utterances:

- Natural boundaries, so no word is split.
- Silence is never decoded at all, which is where the CPU saving comes from.
- `maxSpeechDuration` caps a monologue so the transcript still updates
  incrementally.
- Memory is bounded by the VAD's own ring buffer plus one utterance.

`SpeechSegment.start` from `Vad.front()` is the sample index since the
detector was constructed, so with one `Vad` per lane per meeting it is
directly the meeting timeline. No separate clock is needed.

## 1.5 Speakers by incremental clustering, not offline diarization of the whole meeting

`OfflineSpeakerDiarization.process(samples)` takes the entire recording in one
Float32Array and clusters it globally. For a three hour meeting that is
170 million floats (690 MB) plus quadratic clustering. It cannot be used on
the whole meeting. Do not try.

Instead, per utterance on the system lane:

1. `SpeakerEmbeddingExtractor.compute()` yields a fixed-size vector (one small
   ONNX forward, tens of milliseconds).
2. Compare it by cosine similarity against the centroids of speakers seen so
   far in this meeting.
3. Above the threshold, it is that speaker, and the centroid is updated with a
   running mean. Below, it is a new speaker.

That is O(1) per utterance in both time and memory, and it works for a meeting
of any length.

**The refinement stage.** A single VAD utterance can contain two speakers when
people talk over each other with no pause. So when an utterance is longer than
`meeting.diarizationRefineOverMs` (default 6000), run
`OfflineSpeakerDiarization.process()` on **that utterance alone** first, and
embed each returned sub-segment separately. The input is capped by
`vadMaxSpeechMs`, so this stage is bounded by construction. This is why the
pyannote segmentation model is in the asset list.

## 1.6 One mixed opus archive, written continuously

The archive is a single `recording.webm` (Opus) per meeting, produced by a
`MediaRecorder` over a `MediaStreamAudioDestinationNode` that both lanes feed.

- One file, directly playable, roughly 14 MB per hour at 32 kbps.
- Written continuously (`start(5000)` gives an `ondataavailable` every five
  seconds), so a crash loses at most five seconds and leaves a WebM that
  players will still open.
- The AudioContext runs at 16 kHz, so the archive is 16 kHz. That is the right
  fidelity for speech and it is what was transcribed.

Connecting both lanes to a `MediaStreamAudioDestinationNode` also gives the
audio graph a real sink, which is what guarantees Chromium keeps pulling it.

Raw PCM is never written to disk. It exists only as 1 second batches in
flight.

## 1.7 Dictation always wins

While a dictation capture is in `arming`, `listening` or `transcribing`, main
sends the worker `{ type: "yield", yielding: true }`. The worker finishes the
utterance it is on and then stops dequeuing until released. Its queue grows
for at most the length of a dictation (bounded by `maxCaptureMs`), which is a
few megabytes, then drains.

This is what makes "no performance drops while doing other operations" true
rather than aspirational.

The worker also runs its ASR with `numThreads` capped at
`max(2, floor(cores / 2))` so it can never saturate the machine.

## 1.8 The queue is bounded, and running out is honest

If the worker's pending utterance audio exceeds `MAX_BACKLOG_SECONDS` (600),
it stops enqueuing and emits a `gap` marker with the start and end of what it
skipped. The transcript then says so, in place, instead of the app silently
eating audio or the process silently eating RAM.

This should be unreachable in practice (Parakeet's measured realtime factor on
this codebase is well under 1, and VAD removes the silence), but "provably
bounded" is the requirement, not "probably fine".

## 1.9 Main is the only SQLite writer

The worker never touches the database. It posts finished segments to main,
main writes them. One writer, one connection, no WAL contention, and the
worker stays free of `better-sqlite3` (which would otherwise need to be
resolvable and rebuilt for a second process).

---

# WS1: shared contracts

Nothing else compiles until this lands. Do this first, in full.

## 1.1 New file: `src/shared/meeting.ts`

The meeting state union, mirroring `src/shared/capture.ts` in style and role:
one authority in main, everything else renders from broadcasts.

```ts
/**
 * Meeting state, shared by every surface: tray, main window, tests. The
 * session in src/main/meeting/meeting-session.ts is the single authority;
 * everything else renders from broadcasts of this union.
 */

export type MeetingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "finalizing"
  | "error";

/** Which capture lane a segment came from. */
export type MeetingSource = "system" | "microphone";

/**
 * Stable identity for a voice within one meeting. "me" is the microphone
 * lane, which needs no clustering. "s1", "s2" and so on are clusters found
 * on the system lane, numbered in first-heard order.
 */
export type SpeakerKey = string;

export interface MeetingLaneHealth {
  readonly live: boolean;
  /** Machine-readable, translated in the renderer. Never a raw Error string. */
  readonly code?: MeetingLaneErrorCode;
}

export type MeetingLaneErrorCode =
  | "loopback-unavailable"
  | "loopback-denied"
  | "microphone-unavailable"
  | "device-changed";

export type MeetingState =
  | { readonly phase: "idle" }
  | { readonly phase: "starting" }
  | {
      readonly phase: "recording";
      readonly meetingId: number;
      readonly startedAtMs: number;
      readonly system: MeetingLaneHealth;
      readonly microphone: MeetingLaneHealth;
      /** Seconds of captured audio not yet transcribed. 0 when keeping up. */
      readonly backlogSeconds: number;
      readonly segmentCount: number;
      readonly speakerCount: number;
    }
  | {
      readonly phase: "paused";
      readonly meetingId: number;
      readonly startedAtMs: number;
      readonly pausedAtMs: number;
      readonly segmentCount: number;
    }
  | {
      readonly phase: "finalizing";
      readonly meetingId: number;
      /** Utterances still queued in the worker, so the UI can show progress. */
      readonly remaining: number;
    }
  | { readonly phase: "error"; readonly code: MeetingErrorCode };

export type MeetingErrorCode =
  | "assets-missing"
  | "engine-not-ready"
  | "worker-failed"
  | "loopback-unavailable"
  | "database-unavailable"
  | "already-running";

export const INITIAL_MEETING_STATE: MeetingState = { phase: "idle" };

export const isMeetingActive = (state: MeetingState): boolean =>
  state.phase === "recording" ||
  state.phase === "paused" ||
  state.phase === "starting" ||
  state.phase === "finalizing";

/** One line of transcript. The shape both processes share. */
export interface MeetingSegment {
  readonly id: number;
  readonly meetingId: number;
  /** Milliseconds from the start of the meeting. */
  readonly startMs: number;
  readonly endMs: number;
  readonly source: MeetingSource;
  readonly speakerKey: SpeakerKey;
  readonly text: string;
  /** True when this row marks audio that was captured but not transcribed. */
  readonly gap: boolean;
}

export interface MeetingRecord {
  readonly id: number;
  readonly title: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly durationMs: number;
  readonly engineId: string;
  readonly modelId: string;
  readonly language: string | null;
  /** Absolute path to recording.webm, or null when archiving was off. */
  readonly audioPath: string | null;
  readonly audioBytes: number;
  readonly speakerCount: number;
  readonly wordCount: number;
  readonly state: "recording" | "complete" | "interrupted";
}

/** Per-meeting speaker labels the user has assigned. */
export interface MeetingSpeaker {
  readonly speakerKey: SpeakerKey;
  readonly label: string;
}

/** The default label for a key with no user-assigned name. */
export const defaultSpeakerLabel = (key: SpeakerKey): string =>
  key === "me" ? "You" : `Speaker ${key.replace(/^s/, "")}`;
```

`defaultSpeakerLabel` returns English. The renderer must **not** use it for
display: it translates `meetings.speaker.you` and
`meetings.speaker.numbered` with the number as a parameter. The function
exists for export files and for main-side titling, where there is no `t()`.
Say so in a comment on it.

## 1.2 New file: `src/shared/meeting-assets.ts`

Meetings need three ONNX files that are not transcription models: a VAD, a
speaker embedding extractor, and a speaker segmentation model. They are
downloaded by the existing downloader but must **not** appear in the Models
view, which lists `MODEL_CATALOG`.

Every size and sha256 below was read from the Hugging Face API tree endpoint
on 2026-08-07. For LFS files the `lfs.oid` field **is** the sha256, which is
the same convention the existing catalog uses (verified against
`parakeet-tdt-0.6b-v3-int8`).

```ts
/**
 * The support models a meeting needs beyond the ASR engine: voice activity
 * detection, speaker embedding, and speaker segmentation. Kept out of
 * MODEL_CATALOG so the Models view stays a page about transcription quality;
 * these are installed once from the Meetings page and never chosen between.
 *
 * Sizes and sha256 hashes come from the Hugging Face API trees for
 * csukuangfj/vad, csukuangfj/speaker-embedding-models and
 * csukuangfj/sherpa-onnx-pyannote-segmentation-3-0.
 */

import type { DownloadBundle } from "./models";

export type MeetingAssetId =
  | "meeting-vad-silero"
  | "meeting-embedding-campplus-en"
  | "meeting-segmentation-pyannote";

export interface MeetingAsset extends DownloadBundle {
  readonly id: MeetingAssetId;
  readonly role: "vad" | "embedding" | "segmentation";
  /** Shown on the install card in the Meetings page. */
  readonly purpose: string;
  readonly license: string;
  /** False for the segmentation model: refinement is optional. */
  readonly required: boolean;
}

export const MEETING_ASSETS: readonly MeetingAsset[] = [
  {
    id: "meeting-vad-silero",
    name: "Silero voice activity detection",
    role: "vad",
    purpose: "Finds where speech starts and stops, so silence is never decoded.",
    license: "MIT",
    required: true,
    bytes: 1_807_522,
    files: [
      {
        path: "silero_vad.onnx",
        url: "https://huggingface.co/csukuangfj/vad/resolve/main/silero_vad.onnx",
        bytes: 1_807_522,
        sha256: "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28"
      }
    ]
  },
  {
    id: "meeting-embedding-campplus-en",
    name: "CAM++ speaker embedding",
    role: "embedding",
    purpose: "Turns a voice into a fingerprint, so the same person keeps the same label.",
    license: "Apache 2.0 (3D-Speaker)",
    required: true,
    bytes: 29_596_978,
    files: [
      {
        path: "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
        url: "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
        bytes: 29_596_978,
        sha256: "357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b"
      }
    ]
  },
  {
    id: "meeting-segmentation-pyannote",
    name: "Pyannote speaker segmentation",
    role: "segmentation",
    purpose: "Splits a long turn when two people talk over each other.",
    license: "MIT (pyannote)",
    required: false,
    bytes: 5_992_913,
    files: [
      {
        path: "model.onnx",
        url: "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx",
        bytes: 5_992_913,
        sha256: "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079"
      }
    ]
  }
];

export const findMeetingAsset = (id: string): MeetingAsset | null =>
  MEETING_ASSETS.find((asset) => asset.id === id) ?? null;

/** Total bytes a first-time install of the required assets costs. */
export const REQUIRED_ASSET_BYTES = MEETING_ASSETS.filter(
  (asset) => asset.required
).reduce((sum, asset) => sum + asset.bytes, 0);
```

Verified alternatives, if you ever need them:

| File | Bytes | sha256 |
|---|---|---|
| `model.int8.onnx` (segmentation, quantised) | 1,540,506 | `d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d` |
| `silero_vad_v5.onnx` | 2,313,101 | `6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396` |
| `wespeaker_en_voxceleb_CAM++.onnx` | 29,292,684 | `c46fad10b5f81e1aa4a60c162714208577093655076c5450f8c469e522ec54ef` |
| `nemo_en_titanet_small.onnx` | 40,257,283 | `ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e` |

Ship v4 of Silero (`silero_vad.onnx`), not v5. v5 changes the state tensor
shape and this repo's sherpa-onnx pin has not been exercised against it here.

## 1.3 Edit `src/shared/models.ts`: extract `DownloadBundle`

The downloader and installer both take `ModelInfo` today but only ever use
`id`, `name`, `bytes` and `files`. Extract the structural part so meeting
assets reuse the machinery without being widened into the model union (which
would leak them into `ProviderMark` and the Models view).

Replace the `ModelInfo` declaration with:

```ts
/**
 * The part of a model the downloader and installer actually need. Meeting
 * assets (src/shared/meeting-assets.ts) satisfy this too, which is how they
 * reuse the resumable downloader without appearing in MODEL_CATALOG.
 */
export interface DownloadBundle {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  readonly files: readonly ModelFile[];
}

export interface ModelInfo extends DownloadBundle {
  readonly engine: "parakeet" | "whisper-cpp";
  readonly languages: string;
  readonly whenToUse: string;
  readonly license: string;
}
```

`ModelInfo`'s fields are currently mutable (`id: string`, not `readonly id`).
Making them readonly is correct and the tree already treats them as such, but
if it causes fallout in `src/main/models/installer.ts` or the tests, keep them
mutable in `DownloadBundle` rather than widening the change.

Then change the parameter types, and nothing else, in:

- `src/main/models/downloader.ts`: every `ModelInfo` in a signature becomes
  `DownloadBundle`. It never reads `engine`, `languages`, `whenToUse` or
  `license`; confirm with a grep before you change it.
- `src/main/models/installer.ts`: same.

Do not touch `src/main/models/index.ts`. `ModelsService` stays a service about
`MODEL_CATALOG`. Meeting assets get their own installer in WS4.4.

## 1.4 Edit `src/shared/settings.ts`

Add the meeting block. Note that `SettingsStore.update` is a **shallow** merge
(`src/main/store/settings-store.ts:40`), so every write to `settings.meeting`
must send the whole object. Every call site in this plan does; keep it that
way.

```ts
export const meetingSettingsSchema = z.object({
  /** Mix your own microphone into the recording and transcribe it as "You". */
  includeMicrophone: z.boolean().default(true),
  /** Toggle accelerator for starting and stopping a meeting. */
  accelerator: z.string().min(1).default(DEFAULT_MEETING_ACCELERATOR),
  /**
   * Which engine transcribes meetings. Local only: a meeting is hours of
   * audio and sending it to a cloud engine is both a bill and a disclosure
   * nobody agreed to. The router is not involved and there is no fallback.
   */
  engineId: z.enum(["parakeet", "whisper-cpp"]).default("parakeet"),
  /** Label speakers on the system lane. Off makes every remote line "Speaker". */
  diarization: z.boolean().default(true),
  /**
   * Utterances longer than this are re-segmented before embedding, so a turn
   * where two people overlap is not collapsed onto one speaker. 0 disables
   * the refinement stage and skips the segmentation model entirely.
   */
  diarizationRefineOverMs: z.number().int().min(0).max(60_000).default(6000),
  /**
   * Cosine similarity above which a voice is judged to be a speaker already
   * heard. Higher splits one person into several; lower merges two people.
   */
  speakerThreshold: z.number().min(0.2).max(0.95).default(0.55),
  /** Hard cap on distinct speakers. 0 lets the clustering decide. */
  maxSpeakers: z.number().int().min(0).max(32).default(0),
  /** Keep the mixed opus recording beside the transcript. */
  archiveAudio: z.boolean().default(true),
  archiveBitrateKbps: z.number().int().min(16).max(128).default(32),
  /** Silero: speech shorter than this is not an utterance (ms). */
  vadMinSpeechMs: z.number().int().min(100).max(2000).default(250),
  /** Silero: silence this long closes an utterance (ms). */
  vadMinSilenceMs: z.number().int().min(200).max(3000).default(500),
  /** Silero: force a boundary in a monologue (ms). */
  vadMaxSpeechMs: z.number().int().min(5000).max(60_000).default(20_000),
  /** Stop a meeting nobody is in. 0 never auto-stops. Minutes. */
  autoStopSilentMinutes: z.number().int().min(0).max(120).default(0),
  /** Delete meetings older than this. 0 keeps them forever. Days. */
  retentionDays: z.number().int().min(0).max(3650).default(0)
});
```

Add to `settingsSchema`:

```ts
  meeting: meetingSettingsSchema.default({
    includeMicrophone: true,
    accelerator: DEFAULT_MEETING_ACCELERATOR,
    engineId: "parakeet",
    diarization: true,
    diarizationRefineOverMs: 6000,
    speakerThreshold: 0.55,
    maxSpeakers: 0,
    archiveAudio: true,
    archiveBitrateKbps: 32,
    vadMinSpeechMs: 250,
    vadMinSilenceMs: 500,
    vadMaxSpeechMs: 20_000,
    autoStopSilentMinutes: 0,
    retentionDays: 0
  })
```

And export the type:

```ts
export type MeetingSettings = z.infer<typeof meetingSettingsSchema>;
```

## 1.5 Edit `src/shared/hotkeys.ts`

Add beside the existing defaults:

```ts
export const DEFAULT_MEETING_ACCELERATOR = "CommandOrControl+Shift+M";
```

Import it into `settings.ts`. Confirm `parseAccelerator` handles it (it should;
it already parses `CommandOrControl+Shift+Space`). Add a case to
`src/shared/hotkeys.test.ts`.

## 1.6 Edit `src/shared/ipc.ts`

Append the meeting channels. Keep the existing file's comment density: a doc
comment where the reason is not obvious, nothing where it is.

```ts
import type {
  MeetingRecord,
  MeetingSegment,
  MeetingSpeaker,
  MeetingState
} from "./meeting";

/** Push channel: the meeting state changed. Broadcast to every window. */
export const meetingStateChangedChannel = "meeting:state-changed" as const;

export const meetingStartChannel = "meeting:start" as const;
export const meetingStopChannel = "meeting:stop" as const;
export const meetingPauseChannel = "meeting:pause" as const;
export const meetingListChannel = "meeting:list" as const;
export const meetingGetChannel = "meeting:get" as const;
export const meetingSegmentsChannel = "meeting:segments" as const;
export const meetingSearchChannel = "meeting:search" as const;
export const meetingDeleteChannel = "meeting:delete" as const;
export const meetingRenameChannel = "meeting:rename" as const;
export const meetingRenameSpeakerChannel = "meeting:rename-speaker" as const;
export const meetingExportChannel = "meeting:export" as const;
export const meetingRevealRecordingChannel = "meeting:reveal-recording" as const;

/**
 * Push channel: one finished transcript line. Sent as it is written, so the
 * live view appends rather than re-reading the meeting on every utterance.
 */
export const meetingSegmentAppendedChannel = "meeting:segment-appended" as const;

/** Push channel: input levels for both lanes, for the live meters. */
export const meetingLevelsChannel = "meeting:levels" as const;

export const meetingAssetsChannel = "meeting:assets" as const;
export const meetingInstallAssetsChannel = "meeting:install-assets" as const;
export const meetingAssetProgressChannel = "meeting:asset-progress" as const;

export interface MeetingStartResult {
  readonly ok: boolean;
  readonly meetingId?: number;
  /** Machine-readable; the renderer translates it. */
  readonly code?: string;
}

export interface MeetingSimpleResult {
  readonly ok: boolean;
}

export interface MeetingPauseResult {
  readonly ok: boolean;
  readonly paused: boolean;
}

export interface MeetingListRequest {
  readonly limit?: number;
  readonly offset?: number;
}

export interface MeetingListResult {
  readonly items: readonly MeetingRecord[];
  readonly total: number;
}

export interface MeetingGetRequest {
  readonly meetingId: number;
}

export interface MeetingGetResult {
  readonly meeting: MeetingRecord | null;
  readonly speakers: readonly MeetingSpeaker[];
}

export interface MeetingSegmentsRequest {
  readonly meetingId: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MeetingSegmentsResult {
  readonly items: readonly MeetingSegment[];
  readonly total: number;
}

export interface MeetingSearchRequest {
  readonly query: string;
  readonly limit?: number;
}

/** A hit carries its meeting so the result list can be grouped without a join. */
export interface MeetingSearchHit {
  readonly segment: MeetingSegment;
  readonly meetingTitle: string;
  readonly meetingStartedAtMs: number;
}

export interface MeetingSearchResult {
  readonly items: readonly MeetingSearchHit[];
}

export interface MeetingRenameRequest {
  readonly meetingId: number;
  readonly title: string;
}

export interface MeetingRenameSpeakerRequest {
  readonly meetingId: number;
  readonly speakerKey: string;
  readonly label: string;
}

export type MeetingExportFormat = "markdown" | "text" | "srt";

export interface MeetingExportRequest {
  readonly meetingId: number;
  readonly format: MeetingExportFormat;
}

export interface MeetingExportResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly code?: string;
}

export interface MeetingSegmentAppendedEvent {
  readonly meetingId: number;
  readonly segment: MeetingSegment;
  readonly speakerCount: number;
}

export interface MeetingLevelsEvent {
  readonly system: number;
  readonly microphone: number;
}

export interface MeetingAssetStatus {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly bytes: number;
  readonly required: boolean;
  readonly installed: boolean;
  readonly download: ModelDownloadState;
}

export interface MeetingAssetsResult {
  readonly items: readonly MeetingAssetStatus[];
  /** True when every required asset is on disk. */
  readonly ready: boolean;
}

export type MeetingAssetProgressEvent =
  | {
      readonly state: "downloading";
      readonly assetId: string;
      readonly receivedBytes: number;
      readonly totalBytes: number;
    }
  | { readonly state: "done"; readonly assetId: string }
  | {
      readonly state: "error";
      readonly assetId: string;
      readonly code: ModelDownloadErrorCode;
      readonly message: string;
    };
```

Then the meeting window's own channels, in the same file:

```ts
/** Main to meeting window: acquire the loopback stream and start recording. */
export const meetingAudioBeginChannel = "meeting-audio:begin" as const;

export interface MeetingAudioBeginRequest {
  readonly includeMicrophone: boolean;
  readonly archiveAudio: boolean;
  readonly archiveBitrateKbps: number;
  /** Persisted dictation device id, so both lanes use the same microphone. */
  readonly microphoneDeviceId: string | null;
}

/** Main to meeting window: stop both lanes and flush the archive. */
export const meetingAudioStopChannel = "meeting-audio:stop" as const;

/**
 * Meeting window to main: one second of 16 kHz mono Int16 for one lane.
 * `startSample` is the index of the first sample since capture began, which
 * is what makes the two lanes share a clock without a wall-clock timestamp.
 */
export const meetingAudioFramesChannel = "meeting-audio:frames" as const;

export interface MeetingAudioFrames {
  readonly source: "system" | "microphone";
  readonly pcm: ArrayBuffer;
  readonly startSample: number;
  readonly sampleRate: number;
}

/** Meeting window to main: an opus chunk for the archive file. */
export const meetingAudioArchiveChannel = "meeting-audio:archive" as const;

export interface MeetingAudioArchiveChunk {
  readonly bytes: ArrayBuffer;
}

/** Meeting window to main: lane health, and the terminal flush signal. */
export const meetingAudioStateChannel = "meeting-audio:state" as const;

export interface MeetingAudioStateEvent {
  readonly system: { readonly live: boolean; readonly code?: string };
  readonly microphone: { readonly live: boolean; readonly code?: string };
  /** True once every archive chunk has been sent and both lanes are closed. */
  readonly finished: boolean;
}

/** Meeting window to main: 10 Hz levels for the two meters. */
export const meetingAudioLevelsChannel = "meeting-audio:levels" as const;
```

Add every one of these to `PRELOAD_CHANNELS` under a `meeting` key and a
`meetingAudio` key. `src/shared/ipc-arguments.test.ts` already asserts the
serialised argument survives a round trip; extend it to cover the new keys.

## 1.7 Edit `src/shared/api.ts`

Add to `MainWindowApi`:

```ts
  readonly meetings: {
    start: () => Promise<MeetingStartResult>;
    stop: () => Promise<MeetingSimpleResult>;
    pause: () => Promise<MeetingPauseResult>;
    list: (request: MeetingListRequest) => Promise<MeetingListResult>;
    get: (request: MeetingGetRequest) => Promise<MeetingGetResult>;
    segments: (request: MeetingSegmentsRequest) => Promise<MeetingSegmentsResult>;
    search: (request: MeetingSearchRequest) => Promise<MeetingSearchResult>;
    remove: (request: MeetingGetRequest) => Promise<MeetingSimpleResult>;
    rename: (request: MeetingRenameRequest) => Promise<MeetingSimpleResult>;
    renameSpeaker: (
      request: MeetingRenameSpeakerRequest
    ) => Promise<MeetingSimpleResult>;
    export: (request: MeetingExportRequest) => Promise<MeetingExportResult>;
    revealRecording: (request: MeetingGetRequest) => Promise<MeetingSimpleResult>;
    assets: () => Promise<MeetingAssetsResult>;
    installAssets: () => Promise<MeetingSimpleResult>;
    onStateChanged: (listener: (state: MeetingState) => void) => () => void;
    onSegmentAppended: (
      listener: (event: MeetingSegmentAppendedEvent) => void
    ) => () => void;
    onLevels: (listener: (event: MeetingLevelsEvent) => void) => () => void;
    onAssetProgress: (
      listener: (event: MeetingAssetProgressEvent) => void
    ) => () => void;
  };
```

And a new window API, following `RecorderWindowApi` exactly:

```ts
export interface MeetingWindowApi {
  readonly windowKind: "meeting";
  readonly onBegin: (
    callback: (request: MeetingAudioBeginRequest) => void
  ) => () => void;
  readonly onStop: (callback: () => void) => () => void;
  readonly sendFrames: (data: MeetingAudioFrames) => void;
  readonly sendArchiveChunk: (data: MeetingAudioArchiveChunk) => void;
  readonly sendState: (data: MeetingAudioStateEvent) => void;
  readonly sendLevels: (data: MeetingLevelsEvent) => void;
}

export type WindowApi =
  | MainWindowApi
  | OverlayWindowApi
  | RecorderWindowApi
  | MeetingWindowApi;
```

## WS1 acceptance

- `pnpm typecheck` passes with the new shared modules present and unused.
- `pnpm test` passes, including a new `src/shared/meeting.test.ts` that covers
  `isMeetingActive` across every phase and `defaultSpeakerLabel` for `me`,
  `s1` and `s12`.
- `src/shared/settings.test.ts` gains a case proving a settings file written by
  v0.3.1 (no `meeting` key) parses and gets the meeting defaults.

---

# WS2: audio capture

## 2.1 Edit `electron.vite.config.ts`

Three additions. The main build gains a second entry (the worker, WS3), the
preload gains a fourth, and the renderer gains a fourth page.

```ts
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Two entries: the main process, and the meeting transcription
        // worker that utilityProcess.fork loads from out/main/.
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          "meeting-worker": resolve(
            __dirname,
            "src/main/meeting/worker/index.ts"
          )
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "[name].cjs"
        }
      }
    }
  },
```

`package.json`'s `main` stays `./out/main/index.cjs`; the named input `index`
preserves that filename. Verify after your first `pnpm build` that both
`out/main/index.cjs` and `out/main/meeting-worker.cjs` exist.

Preload input gains `meeting: resolve(__dirname, "src/preload/meeting.ts")`.
Renderer input gains `meeting: resolve(rendererRoot, "meeting/index.html")`.

## 2.2 New file: `src/main/windows/meeting-window.ts`

Follow `recorder-window.ts` closely. The differences that matter:

```ts
/**
 * The meeting capture window: hidden, never focused, and created only while a
 * meeting runs. It owns the Windows loopback stream, a second microphone
 * stream, and the opus archive encoder.
 *
 * It is deliberately not the recorder window. That one owns the permanently
 * warm dictation microphone and gates the global keyboard hook; putting
 * getDisplayMedia, a second AudioContext and a MediaRecorder in it would put
 * the product's hot path behind a feature that is idle most of the time.
 */

import { BrowserWindow } from "electron";
import { join } from "node:path";
import { PRELOAD_CHANNELS } from "../../shared/ipc";

const channelsArg = `--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`;

export const createMeetingWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The window is never shown, so Chromium would otherwise throttle its
      // timers and its MediaRecorder cadence to once a second. The audio
      // worklet runs on the real-time audio thread and is immune, but the
      // encoder and the message pump are not.
      backgroundThrottling: false,
      preload: join(__dirname, "../preload/meeting.cjs"),
      additionalArguments: [channelsArg]
    }
  });

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/meeting/index.html`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/meeting/index.html"));
  }

  return window;
};
```

## 2.3 The loopback permission handler

Windows system audio comes from `getDisplayMedia` with Electron's loopback
option. Verified in `node_modules/electron/electron.d.ts:22596`:

```
audio?: (('loopback' | 'loopbackWithMute')) | (WebFrameMain);
```

`loopback` captures system audio and leaves it audible. `loopbackWithMute`
mutes local playback, which would silence the meeting for the user. Never use
`loopbackWithMute`.

Add to `src/main/index.ts`, inside `whenReady`, before the meeting session is
built. Put the code in a new file `src/main/meeting/loopback.ts` and call it
from `index.ts` so `index.ts` does not grow another inline block:

```ts
/**
 * Grants Windows loopback audio to the meeting window and nothing else.
 *
 * Chromium requires a video track in a getDisplayMedia request even when only
 * audio is wanted, so a screen source is supplied and the renderer stops the
 * video track the instant the stream resolves. Nothing is ever encoded from
 * it.
 */

import { desktopCapturer, session } from "electron";

export const installLoopbackHandler = (): void => {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const url = request.frame?.url ?? "";
      if (!url.includes("meeting/index.html")) {
        // Only the meeting window may capture the desktop. Anything else is
        // refused rather than silently granted.
        callback({});
        return;
      }
      void desktopCapturer
        .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const screenSource = sources[0];
          if (screenSource === undefined) {
            callback({});
            return;
          }
          callback({ video: screenSource, audio: "loopback" });
        })
        .catch(() => {
          callback({});
        });
    }
  );
};
```

**User activation.** `getDisplayMedia` requires transient user activation in
Chromium. A meeting started from a global hotkey has none, and the meeting
window is hidden so it can never receive a click. Drive the acquisition from
main with an explicit gesture instead:

```ts
// In meeting-session.ts, once the window has finished loading.
await window.webContents.executeJavaScript(
  "window.__struqBeginMeetingAudio()",
  true
);
```

The second argument is `userGesture`. `executeJavaScript` evaluates in the
page's main world, which under `sandbox: true` with `contextIsolation: true`
is where the renderer bundle itself runs (the preload runs in the isolated
world), so it can see a function the bundle assigned to `window`. This is the
only supported path; do not add a fallback that tries `getDisplayMedia`
without a gesture and hopes.

The `begin` IPC channel still exists and still carries the request payload.
The order is: main sends `meeting-audio:begin` with the options, the renderer
stores them, then main calls `__struqBeginMeetingAudio()` to do the acquiring.
Keep those two steps separate so the payload never has to be serialised into a
JavaScript string.

## 2.4 New file: `src/renderer/meeting/meeting-collector.worklet.js`

Plain JS, no imports, self-contained (worklets are loaded with `addModule`).
Model it on `pcm-collector.worklet.js` but note what is deliberately different:
there is no ring buffer and no pre-roll (a meeting has no hot path to shave),
and the worklet posts on its own schedule rather than waiting to be asked.

```js
/**
 * The meeting-collector AudioWorklet processor.
 *
 * One instance per lane. It converts to Int16 and posts a fixed batch every
 * BATCH_SAMPLES, carrying the index of the first sample so the two lanes share
 * one clock without a wall-clock timestamp.
 *
 * The batching lives here rather than on a renderer timer on purpose: this
 * runs on the real-time audio thread, which Chromium never throttles, while a
 * setInterval in a hidden window is throttled to once a second.
 */

const BATCH_SAMPLES = 16000; // 1 second at 16 kHz

class MeetingCollectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(BATCH_SAMPLES);
    this.filled = 0;
    this.totalSamples = 0;
    this.peak = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data.type === "flush") {
        this.flush(true);
        this.stopped = true;
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  flush(partial) {
    if (this.filled === 0) return;
    const length = partial ? this.filled : BATCH_SAMPLES;
    const out = this.buffer.slice(0, length);
    this.port.postMessage(
      {
        type: "batch",
        pcm: out.buffer,
        startSample: this.totalSamples - length,
        peak: this.peak
      },
      [out.buffer]
    );
    this.filled = 0;
    this.peak = 0;
  }

  process(inputs) {
    if (this.stopped) return true;
    const input = inputs[0];
    if (input === undefined || input.length === 0) return true;
    const channel = input[0];
    if (channel === undefined) return true;

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i] ?? 0;
      const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
      const magnitude = clamped < 0 ? -clamped : clamped;
      if (magnitude > this.peak) this.peak = magnitude;
      this.buffer[this.filled] = Math.round(clamped * 32767);
      this.filled += 1;
      this.totalSamples += 1;
      if (this.filled === BATCH_SAMPLES) {
        this.flush(false);
      }
    }
    return true;
  }
}

registerProcessor("meeting-collector", MeetingCollectorProcessor);
```

The `peak` field rides along so the level meters cost nothing extra: no
AnalyserNode, no second timer.

## 2.5 New file: `src/renderer/meeting/audio.ts`

The renderer half. Structure it as one exported `initMeetingAudio(api)` like
`src/renderer/recorder/audio.ts`, with module-level pipeline state.

Required behaviour, in order:

1. On `api.onBegin(request)`, store `request` and assign
   `window.__struqBeginMeetingAudio = () => { void begin(); }`. Do not start
   capturing here.

2. `begin()`:

   ```ts
   const display = await navigator.mediaDevices.getDisplayMedia({
     audio: true,
     // Chromium refuses an audio-only display capture, so a video track is
     // requested at the smallest size it will accept and stopped immediately.
     // Nothing reads it.
     video: { width: { max: 2 }, height: { max: 2 }, frameRate: { max: 1 } }
   });
   for (const track of display.getVideoTracks()) {
     track.stop();
     display.removeTrack(track);
   }
   ```

   A rejection here is not fatal to the app: send
   `sendState({ system: { live: false, code: "loopback-unavailable" }, ... })`
   and stop. Distinguish `NotAllowedError` as `loopback-denied`.

3. Build the graph. One `AudioContext({ sampleRate: 16000 })`, as the recorder
   does, so Chromium resamples the 48 kHz loopback for us:

   ```ts
   const context = new AudioContext({ sampleRate: 16000 });
   await context.audioWorklet.addModule(workletUrl);

   const archiveSink = context.createMediaStreamDestination();

   const systemSource = context.createMediaStreamSource(display);
   const systemWorklet = new AudioWorkletNode(context, "meeting-collector");
   systemSource.connect(systemWorklet);
   systemSource.connect(archiveSink);
   ```

   The microphone lane is identical, gated on `request.includeMicrophone`, and
   acquired with the same constraints the recorder uses
   (`echoCancellation: false, noiseSuppression: false, autoGainControl: true`,
   plus `deviceId` when `request.microphoneDeviceId` is not null). Connecting
   both sources to `archiveSink` is the mix.

   Connecting to `archiveSink` also gives the graph a real destination, which
   is what keeps Chromium pulling it.

4. Archive, when `request.archiveAudio`:

   ```ts
   const recorder = new MediaRecorder(archiveSink.stream, {
     mimeType: "audio/webm;codecs=opus",
     audioBitsPerSecond: request.archiveBitrateKbps * 1000
   });
   recorder.ondataavailable = (event) => {
     if (event.data.size === 0) return;
     void event.data.arrayBuffer().then((bytes) => {
       api.sendArchiveChunk({ bytes });
     });
   };
   recorder.start(5000);
   ```

   Check `MediaRecorder.isTypeSupported` first and fall back to
   `"audio/webm"`. If neither is supported, carry on without an archive and
   report it; a transcript with no recording is far better than no meeting.

5. Each worklet's `port.onmessage` forwards straight through, with no
   buffering in the renderer:

   ```ts
   worklet.port.onmessage = (event) => {
     const message = event.data as {
       type?: string;
       pcm?: ArrayBuffer;
       startSample?: number;
       peak?: number;
     };
     if (message.type === "batch" && message.pcm !== undefined) {
       lastPeak[source] = message.peak ?? 0;
       api.sendFrames({
         source,
         pcm: message.pcm,
         startSample: message.startSample ?? 0,
         sampleRate: 16000
       });
       return;
     }
     if (message.type === "flushed") {
       markLaneFlushed(source);
     }
   };
   ```

6. Levels: a single `setInterval` at 100 ms sending `lastPeak` for both lanes.
   This is the only timer in the file, it is 10 Hz not 60 Hz, and
   `backgroundThrottling: false` on the window keeps it honest.

7. `api.onStop()`: post `{ type: "flush" }` to each worklet, call
   `recorder.stop()`, wait for the last `ondataavailable` and for both
   `flushed` acknowledgements, then send
   `sendState({ ..., finished: true })`, stop every track and close the
   context. Main destroys the window only after it sees `finished: true`, or
   after a 5 second timeout. Losing the tail of a meeting because the window
   was torn down early is the failure mode this ordering prevents.

8. Watchdogs. The loopback track's `ended` event fires when the default render
   endpoint changes (the user plugs in headphones). On `ended`, report
   `{ live: false, code: "device-changed" }` and try to reacquire once after
   1500 ms. Do the same for the microphone track, reusing the shape from
   `src/renderer/recorder/audio.ts:247`.

## 2.6 New files: `src/renderer/meeting/index.html`, `src/renderer/meeting/meeting.ts`, `src/preload/meeting.ts`

`index.html` mirrors `src/renderer/recorder/index.html`. `meeting.ts` is four
lines: cast `window.struqVoice` to `MeetingWindowApi` and call
`initMeetingAudio(api)`. Under `STRUQ_VOICE_E2E=1` the window is never created,
so unlike the recorder there is no e2e branch to write.

`src/preload/meeting.ts` copies `src/preload/recorder.ts` exactly in shape:
read `--struq-channels` from argv, expose the typed API through
`contextBridge`, transfer `pcm` and `bytes` in the send calls.

## WS2 acceptance

- `pnpm build` emits `out/renderer/meeting/index.html`,
  `out/preload/meeting.cjs` and `out/main/meeting-worker.cjs`.
- With a temporary debug hook, starting a meeting logs a `meeting-audio:frames`
  arriving in main once per second per lane, with `startSample` increasing by
  exactly 16000 each time.
- Playing music in another app and starting a meeting produces non-zero
  `peak` values on the system lane.
- The dictation hotkey still works while a meeting runs.

---

# WS3: the transcription worker

Lives under `src/main/meeting/worker/`. It is a `utilityProcess`, so it talks
over `process.parentPort`, never over `ipcMain`. It must not import
`electron`, `better-sqlite3`, or anything under `src/renderer/`.

## 3.1 New file: `src/main/meeting/worker/protocol.ts`

The message union both sides share. Put it here rather than in
`src/shared/ipc.ts`: these are not IPC channels between processes Electron
manages for us, they are one module's private wire format, and the ipc.ts rule
is about renderer-facing channels.

```ts
/**
 * The wire format between main and the meeting worker utilityProcess.
 * Structured clone only: no functions, no class instances. ArrayBuffers are
 * copied rather than transferred, because UtilityProcess.postMessage takes a
 * transfer list of MessagePortMain only. At one second of 16 kHz mono Int16
 * that is a 32 KB copy per lane per second, which is not worth engineering
 * around.
 */

export interface WorkerInit {
  readonly type: "init";
  readonly engineId: "parakeet" | "whisper-cpp";
  readonly modelsRoot: string;
  readonly runtimeRoot: string;
  readonly modelId: string;
  readonly assetPaths: {
    readonly vad: string;
    readonly embedding: string;
    /** Null when refinement is off or the asset is not installed. */
    readonly segmentation: string | null;
  };
  readonly numThreads: number;
  readonly diarization: boolean;
  readonly diarizationRefineOverMs: number;
  readonly speakerThreshold: number;
  readonly maxSpeakers: number;
  readonly vadMinSpeechMs: number;
  readonly vadMinSilenceMs: number;
  readonly vadMaxSpeechMs: number;
  readonly speechLanguage: string | null;
}

export interface WorkerFrames {
  readonly type: "frames";
  readonly source: "system" | "microphone";
  readonly pcm: ArrayBuffer;
  readonly startSample: number;
}

/** Dictation is active. Finish the current utterance, then hold. */
export interface WorkerYield {
  readonly type: "yield";
  readonly yielding: boolean;
}

/** No more audio is coming. Drain the queue, then exit. */
export interface WorkerDrain {
  readonly type: "drain";
}

export type WorkerCommand = WorkerInit | WorkerFrames | WorkerYield | WorkerDrain;

export interface WorkerReady {
  readonly type: "ready";
}

export interface WorkerSegment {
  readonly type: "segment";
  readonly source: "system" | "microphone";
  readonly startMs: number;
  readonly endMs: number;
  readonly speakerKey: string;
  readonly text: string;
}

export interface WorkerGap {
  readonly type: "gap";
  readonly source: "system" | "microphone";
  readonly startMs: number;
  readonly endMs: number;
}

/** Sent at most once a second, so main can drive the backlog indicator. */
export interface WorkerHeartbeat {
  readonly type: "heartbeat";
  readonly queuedSeconds: number;
  readonly speakerCount: number;
}

export interface WorkerFailure {
  readonly type: "failure";
  readonly code: "engine-not-ready" | "assets-missing" | "decode-failed";
  readonly message: string;
}

export interface WorkerDrained {
  readonly type: "drained";
}

export type WorkerEvent =
  | WorkerReady
  | WorkerSegment
  | WorkerGap
  | WorkerHeartbeat
  | WorkerFailure
  | WorkerDrained;
```

## 3.2 New file: `src/main/meeting/worker/vad-lane.ts`

Pure logic, unit tested with a fake VAD. This is where most of the correctness
risk lives, so it is deliberately separated from the native module.

The sherpa-onnx `Vad` API, verified in
`node_modules/sherpa-onnx-node/vad.js`:

```
new Vad(config, bufferSizeInSeconds)
vad.acceptWaveform(Float32Array)
vad.isEmpty() -> boolean
vad.front(enableExternalBuffer?) -> { start: number, samples: Float32Array }
vad.pop()
vad.flush()
vad.reset()
```

`SpeechSegment.start` is the sample index since construction, so with one
`Vad` per lane per meeting it is the meeting timeline directly.

Config shape, from `node_modules/sherpa-onnx-node/types.js:156`:

```ts
{
  sileroVad: {
    model: assetPaths.vad,
    threshold: 0.5,
    minSilenceDuration: vadMinSilenceMs / 1000,
    minSpeechDuration: vadMinSpeechMs / 1000,
    maxSpeechDuration: vadMaxSpeechMs / 1000,
    windowSize: 512
  },
  sampleRate: 16000,
  numThreads: 1,
  provider: "cpu",
  debug: false
}
```

Feed the detector in exact `windowSize` chunks, buffering the remainder
between calls. The official sherpa examples do this, and it removes a class of
bug that would otherwise only show up on some chunk alignments.

```ts
export interface VadLaneOptions {
  readonly windowSize: number;
  readonly acceptWindow: (window: Float32Array) => void;
  readonly drainSegments: () => readonly { start: number; samples: Float32Array }[];
  readonly onUtterance: (utterance: {
    startSample: number;
    samples: Float32Array;
  }) => void;
}
```

`pushInt16(pcm: Int16Array)` converts to Float32 in place (`value / 32768`,
matching `parakeet.ts:285`), appends to a carry buffer, feeds every complete
window, then calls `drainSegments` and forwards each to `onUtterance`.

`flush()` calls the injected flush and drains one last time.

Test it with a fake that returns segments on cue. Assert: partial windows are
carried across calls, sample indices are absolute, and nothing is emitted for
a silent lane.

## 3.3 New file: `src/main/meeting/worker/speaker-clusterer.ts`

Pure, no native module, fully unit testable.

```ts
/**
 * Incremental speaker clustering for one meeting.
 *
 * Offline diarization over a whole meeting is not an option: it wants every
 * sample in one array and clusters quadratically, so a three hour recording
 * is 690 MB before the algorithm starts. This assigns a label per utterance
 * in constant time and constant memory instead, by keeping one running
 * centroid per speaker and comparing new embeddings against them.
 */

export interface SpeakerClusterer {
  /** Returns the key for this voice, registering a new speaker if needed. */
  assign: (embedding: Float32Array) => string;
  count: () => number;
}

export const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const createSpeakerClusterer = (options: {
  readonly threshold: number;
  /** 0 means the clustering decides how many speakers there are. */
  readonly maxSpeakers: number;
}): SpeakerClusterer => {
  const centroids: { key: string; vector: Float32Array; observations: number }[] = [];

  return {
    assign: (embedding) => {
      let best: (typeof centroids)[number] | null = null;
      let bestScore = -1;
      for (const candidate of centroids) {
        const score = cosineSimilarity(embedding, candidate.vector);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }

      const capped =
        options.maxSpeakers > 0 && centroids.length >= options.maxSpeakers;

      if (best !== null && (bestScore >= options.threshold || capped)) {
        // Running mean: the centroid sharpens as the meeting goes on, and one
        // odd utterance cannot drag an established speaker.
        const next = best.observations + 1;
        for (let i = 0; i < best.vector.length; i++) {
          const previous = best.vector[i] ?? 0;
          best.vector[i] = previous + ((embedding[i] ?? 0) - previous) / next;
        }
        best.observations = next;
        return best.key;
      }

      const key = `s${String(centroids.length + 1)}`;
      centroids.push({
        key,
        vector: Float32Array.from(embedding),
        observations: 1
      });
      return key;
    },
    count: () => centroids.length
  };
};
```

Tests to write in `speaker-clusterer.test.ts`:

- Two clearly different vectors produce `s1` and `s2`.
- A vector near an existing centroid returns the existing key.
- With `maxSpeakers: 2`, a third distinct voice is folded into the nearest of
  the two rather than creating `s3`.
- The centroid moves toward repeated observations (assert the similarity to
  the newest vector rises after several `assign` calls).
- `cosineSimilarity` returns 0 for a zero vector rather than `NaN`.

## 3.4 New file: `src/main/meeting/worker/index.ts`

The worker entry. Everything native is loaded here, lazily, exactly as
`parakeet.ts` does it, so a missing addon reports a failure instead of
crashing the process on load.

Structure:

```ts
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

let sherpa: SherpaMeetingModule | null = null;
```

On `init`:

1. `sherpa = nodeRequire("sherpa-onnx-node")`. On throw, post
   `{ type: "failure", code: "assets-missing", message }` and return.
2. Build the ASR engine by calling the existing factories. They take injected
   options and import no Electron, so they work here unchanged:
   `createParakeetEngine({ modelsRoot, modelId, numThreads })` from
   `src/main/engines/parakeet.ts`, or
   `createWhisperCppEngine({ runtimeRoot, modelsRoot, modelId })` from
   `src/main/engines/whisper-cpp.ts`. Await `engine.readiness()`; on
   `ready: false`, post `{ type: "failure", code: "engine-not-ready" }`.
   Call `engine.warmup()` before posting `ready`, so the first utterance of a
   meeting is not the one that pays the 1 to 3 second model load.
3. Build one `Vad` per active lane, the `SpeakerEmbeddingExtractor`, and
   (when `assetPaths.segmentation` is non-null and
   `diarizationRefineOverMs > 0`) one `OfflineSpeakerDiarization`.
4. Post `{ type: "ready" }`.

Config shapes, all verified against `node_modules/sherpa-onnx-node/types.js`:

```ts
const extractor = new sherpa.SpeakerEmbeddingExtractor({
  model: assetPaths.embedding,
  numThreads: 1,
  debug: false,
  provider: "cpu"
});

const diarizer = new sherpa.OfflineSpeakerDiarization({
  segmentation: {
    pyannote: { model: assetPaths.segmentation },
    numThreads: 1,
    debug: false,
    provider: "cpu"
  },
  embedding: {
    model: assetPaths.embedding,
    numThreads: 1,
    debug: false,
    provider: "cpu"
  },
  // -1 lets the threshold decide how many voices are in this utterance, which
  // is the only sensible setting when the input is one turn of unknown shape.
  clustering: { numClusters: -1, threshold: 0.55 },
  minDurationOn: 0.3,
  minDurationOff: 0.5
});
```

Embedding one utterance, verified against
`node_modules/sherpa-onnx-node/speaker-identification.js` and
`streaming-asr.js`:

```ts
const embed = (samples: Float32Array): Float32Array => {
  const stream = extractor.createStream();
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  stream.inputFinished();
  return extractor.compute(stream);
};
```

`OfflineSpeakerDiarization.process(samples)` returns
`{ start: number, end: number, speaker: number }[]` with times in **seconds**
(`types.js:756`).

### The queue and the decode loop

```ts
interface QueuedUtterance {
  readonly source: "system" | "microphone";
  readonly startSample: number;
  readonly samples: Float32Array;
}

const queue: QueuedUtterance[] = [];
let queuedSamples = 0;
let decoding = false;
let yielding = false;
let draining = false;

const MAX_BACKLOG_SAMPLES = 600 * 16000; // ten minutes
```

`enqueue(utterance)`:

- If `queuedSamples + utterance.samples.length > MAX_BACKLOG_SAMPLES`, post a
  `gap` event covering the utterance and drop it. Do not grow the queue.
- Otherwise push, add to `queuedSamples`, and `void pump()`.

`pump()`:

```ts
const pump = async (): Promise<void> => {
  if (decoding) return;
  if (yielding && !draining) return;
  const next = queue.shift();
  if (next === undefined) {
    if (draining) parentPort.postMessage({ type: "drained" });
    return;
  }
  decoding = true;
  queuedSamples -= next.samples.length;
  try {
    await transcribeUtterance(next);
  } catch (error) {
    // A failed utterance is one lost line, never a failed meeting.
    postFailureOnce(error);
  } finally {
    decoding = false;
    // setImmediate, not recursion: the event loop must get a turn between
    // decodes or the parentPort messages carrying new audio never arrive.
    setImmediate(() => { void pump(); });
  }
};
```

The `setImmediate` is not optional. `decode()` is a blocking native call, so
without yielding to the event loop between utterances the worker would stop
reading its own input queue and audio would pile up in the OS pipe.

`transcribeUtterance(utterance)`:

1. Microphone lane: speaker key is `me`, no embedding, no diarization.
2. System lane with `diarization: false`: speaker key is `s1` for everything.
3. System lane with diarization on:
   - If `durationMs <= diarizationRefineOverMs` or there is no diarizer, embed
     the whole utterance once and `clusterer.assign(embedding)`.
   - Otherwise call `diarizer.process(samples)`, and for each returned
     sub-segment longer than 0.4 seconds, slice the samples, embed, assign,
     and transcribe that slice on its own. Merge adjacent sub-segments that
     land on the same key before transcribing, so one continuous turn is one
     line rather than three.
4. Transcribe with the engine:
   ```ts
   const controller = new AbortController();
   const outcome = await engine.transcribe({
     pcm: toInt16(samples),
     durationMs,
     ...(speechLanguage !== null ? { language: speechLanguage } : {}),
     signal: controller.signal
   });
   ```
   Note `exactOptionalPropertyTypes`: `language` must be spread conditionally,
   not passed as `undefined`.
5. Trim the text. Empty results are dropped silently: VAD occasionally passes
   a cough.
6. Post `{ type: "segment", source, startMs, endMs, speakerKey, text }` where
   `startMs = Math.round(startSample / 16)` (16 samples per millisecond at
   16 kHz).

### Heartbeat

A 1000 ms interval posting
`{ type: "heartbeat", queuedSeconds: queuedSamples / 16000, speakerCount }`.
Clear it on `drain`.

### Drain

On `{ type: "drain" }`: set `draining = true`, flush each `Vad`, enqueue
whatever comes out, then let `pump` run to empty and post
`{ type: "drained" }`. Main kills the process on `drained` or after a
30 second timeout, whichever comes first.

## 3.5 Trimming and silence

Reuse `trimSilence` and `slicePcm` from `src/main/audio/wav.ts` on each
utterance before decoding, exactly as `src/main/index.ts:389` does for
dictation. VAD boundaries already include a little padding and the engines
want the speech.

## WS3 acceptance

- `pnpm test` covers `vad-lane.ts` and `speaker-clusterer.ts` with injected
  fakes, no native module loaded.
- A manual run with a two-speaker WAV played through the system produces
  `s1` and `s2` keys and no `s3`.
- Killing the worker process from Task Manager mid-meeting surfaces as a
  `worker-failed` meeting error, and the app stays up with dictation working.

---

# WS4: main-process orchestration

## 4.1 New file: `src/main/meeting/worker-client.ts`

Owns the `utilityProcess` lifecycle. Injected into the session so the session
can be unit tested against a fake.

```ts
export interface MeetingWorkerClient {
  start: (init: WorkerInit) => Promise<Result<void>>;
  sendFrames: (frames: WorkerFrames) => void;
  setYielding: (yielding: boolean) => void;
  /** Resolves when the worker reports drained, or after timeoutMs. */
  drain: (timeoutMs: number) => Promise<void>;
  kill: () => void;
  onEvent: (listener: (event: WorkerEvent) => void) => () => void;
}
```

Implementation notes:

- `utilityProcess.fork(join(__dirname, "meeting-worker.cjs"), [], { serviceName: "struq-meeting" })`.
  `__dirname` in the built main process is `out/main`, which is where the
  second rollup entry lands, in both dev and packaged builds.
- `utilityProcess.fork` can only be called after the app `ready` event
  (`electron.d.ts:14970`). Meetings only start after boot, so this is
  satisfied, but do not hoist the fork to module scope.
- Wire `child.on("exit")` to emit a synthetic
  `{ type: "failure", code: "worker-failed" }` when the exit was not requested.
- `start` resolves when the first `ready` or `failure` arrives, with a 30
  second timeout (a cold Parakeet warmup on a slow disk is genuinely slow).

## 4.2 New file: `src/main/meeting/meeting-session.ts`

The one authority on meeting state, in the same shape as
`src/main/session/capture-session.ts`: a factory taking injected dependencies,
returning an object with commands and a `subscribe`.

```ts
export interface MeetingSessionOptions {
  readonly settings: () => MeetingSettings;
  readonly speechLanguage: () => string;
  readonly store: MeetingStore | null;
  readonly worker: MeetingWorkerClient;
  readonly window: {
    create: () => Promise<MeetingAudioWindow>;
    destroy: () => void;
  };
  readonly archive: ArchiveWriter;
  readonly assets: MeetingAssetService;
  readonly paths: {
    readonly modelsRoot: string;
    readonly runtimeRoot: string;
    readonly meetingsRoot: string;
  };
  readonly resolveModelId: (engineId: "parakeet" | "whisper-cpp") => string;
  readonly cores: number;
}

export interface MeetingSession {
  readonly state: MeetingState;
  start: () => Promise<MeetingStartResult>;
  stop: () => Promise<void>;
  togglePause: () => boolean;
  /** Called by the capture session so dictation always wins. */
  setDictationActive: (active: boolean) => void;
  subscribe: (listener: (state: MeetingState) => void) => () => void;
  onSegment: (
    listener: (event: MeetingSegmentAppendedEvent) => void
  ) => () => void;
  dispose: () => void;
}
```

`start()` sequence, and the order matters:

1. Refuse with `already-running` unless the phase is `idle` or `error`.
2. Refuse with `database-unavailable` when `store` is null. A meeting whose
   transcript cannot be saved is not worth recording.
3. Refuse with `assets-missing` when the required assets are not installed.
   The renderer turns that into the install card, not an error toast.
4. Set `starting` and broadcast.
5. `store.createMeeting(...)` returns the id. The row is written with
   `state: "recording"` immediately, so a crash leaves evidence.
6. `mkdir` `meetingsRoot/<id>` and open the archive writer.
7. `worker.start(init)`. On failure, mark the meeting `interrupted` and go to
   `error`.
8. Create the window, wait for `did-finish-load`, send
   `meeting-audio:begin`, then `executeJavaScript("window.__struqBeginMeetingAudio()", true)`.
9. On the first `meeting-audio:state` with `system.live === true`, move to
   `recording`.
10. If no lane goes live within 8 seconds, stop and report
    `loopback-unavailable`.

`stop()` sequence:

1. `finalizing`, broadcast.
2. Send `meeting-audio:stop`; wait for `finished: true` or 5 seconds.
3. Close the archive writer, stat the file for `audioBytes`.
4. `worker.drain(30_000)`, updating `remaining` from heartbeats so the UI can
   show a progress line rather than a spinner.
5. `worker.kill()`, destroy the window.
6. `store.finalizeMeeting(id, { endedAtMs, durationMs, audioBytes, speakerCount, wordCount, state: "complete" })`.
7. `idle`.

Pause: stop forwarding frames to the worker and tell the window to stop
recording the archive. Do not tear anything down. Timeline gaps are natural,
because `startSample` keeps counting only while audio flows; record the paused
span so export can render a marker.

`setDictationActive` forwards straight to `worker.setYielding`.

Auto-stop: when `autoStopSilentMinutes > 0` and no utterance has been produced
on either lane for that long, call `stop()`. Reset the timer on every segment.

## 4.3 New file: `src/main/meeting/archive-writer.ts`

```ts
export interface ArchiveWriter {
  open: (filePath: string) => Promise<Result<void>>;
  append: (bytes: ArrayBuffer) => void;
  close: () => Promise<number>;
  isOpen: () => boolean;
}
```

A `createWriteStream` in append mode with an internal queue so `append` never
blocks the IPC handler. `close` ends the stream and resolves the byte count
from `stat`. Every filesystem operation is injected so it can be unit tested
with an in-memory fake, the way `downloader.test.ts` does it.

## 4.4 New file: `src/main/meeting/assets.ts`

```ts
export interface MeetingAssetService {
  list: () => MeetingAssetsResult;
  /** True when every required asset is present. */
  isReady: () => boolean;
  installMissing: () => Promise<void>;
  pathFor: (role: "vad" | "embedding" | "segmentation") => string | null;
  subscribe: (listener: (result: MeetingAssetsResult) => void) => () => void;
}
```

Build it on the same primitives `createModelsService` uses:
`createDownloader(assetsRoot, { fetch, emitProgress })` and
`createModelInstaller(assetsRoot)` from `src/main/models/`, both of which now
take `DownloadBundle` after WS1.3. `assetsRoot` is
`join(app.getPath("userData"), "meeting-assets")`, kept separate from
`models/` so `totalDiskUsed` on the Models page keeps meaning "transcription
models".

Pass `netFetch` from `src/main/index.ts:46`, not `globalThis.fetch`. That is
the whole reason model downloads work on managed corporate machines, and
skipping it would reintroduce the bug the comment there describes.

`pathFor("vad")` returns
`join(assetsRoot, "meeting-vad-silero", "silero_vad.onnx")`, and so on. Derive
it from the asset's single `files[0].path` rather than hard-coding the
filename twice.

## 4.5 New file: `src/main/meeting/ipc.ts`

Register every meeting channel here rather than growing
`src/main/ipc.ts`, which is already 500 lines. Call it from
`registerIpcHandlers` with the session and store injected, so the boundary
stays "one place declares, one place dispatches".

Every handler is thin: validate, call the store or the session, return. No
logic. Degrade the same way the existing handlers do: a null store returns
`{ items: [], total: 0 }`, never a rejected invoke.

`meeting:export` and `meeting:reveal-recording` use `dialog.showSaveDialog`
and `shell.showItemInFolder`, matching `dictionaryExportChannel`.

## 4.6 New file: `src/main/hotkeys/meeting-shortcut.ts`

A sibling of `toggle-shortcut.ts`, same shape and same
"attempted once per accelerator" behaviour. Import `shouldAttemptRegister`
from `toggle-shortcut.ts` (it is already exported and pure) rather than
duplicating it. Do not generalise `toggle-shortcut.ts` itself: it carries
module-level state that a passing test suite depends on, and the churn is not
worth it for a second binding.

Wire it into `src/main/hotkeys/index.ts`:

- `HotkeyInput` gains `onMeetingToggle: () => void`.
- `HotkeyController.setHotkeys` gains a third parameter,
  `meetingAccelerator: string`.
- `init`, `setPaused` and `dispose` register, release and re-register it
  alongside the toggle.

Update `src/main/index.ts:594` and the `settingsStore.subscribe` below it to
pass `latest.meeting.accelerator`.

## 4.7 Edit `src/main/index.ts`

The wiring, kept to the minimum:

```ts
    const meetingAssets = createMeetingAssetService(
      join(app.getPath("userData"), "meeting-assets"),
      { fetch: netFetch }
    );
    const meetings = createMeetingSession({ /* per 4.2 */ });

    // Dictation always wins. The meeting worker finishes the utterance it is
    // on and then holds until the capture is done.
    session.subscribe((state) => {
      meetings.setDictationActive(state.phase !== "idle" && state.phase !== "error");
    });

    meetings.subscribe((state) => {
      tray.setMeetingState(state);
      broadcast(meetingStateChangedChannel, state);
    });
```

Add `installLoopbackHandler()` right after `Menu.setApplicationMenu(null)`.

Add crash recovery immediately after the database opens:

```ts
    // A meeting row still marked recording is one the app did not survive.
    // Its segments are already on disk; mark the meeting so the list is
    // honest rather than showing it as live forever.
    meetingStore?.markInterruptedOnBoot();
```

Add retention, when `settings.meeting.retentionDays > 0`: one sweep at boot,
deleting rows older than the cutoff and their recording directories. Run it
after a 10 second delay so it never competes with boot.

Add to `app.on("will-quit")`: `meetings.dispose()`, which kills the worker and
destroys the window. A meeting in progress at quit is finalized as
`interrupted`, not lost.

## 4.8 Edit `src/main/tray.ts`

- `TrayInput` gains `onToggleMeeting: () => void`.
- `TrayController` gains `setMeetingState: (state: MeetingState) => void`.
- `buildMenu` gains an item above the separator:
  `t(locale, meetingActive ? "tray.stopMeeting" : "tray.startMeeting")`.
- The tooltip appends the meeting state when one is running.
- Add the two message keys to every locale file in
  `src/shared/i18n/locales/`. Main translates native OS chrome itself, which
  is exactly what the tray is; that rule is in AGENTS.md section 15.

Extend `src/main/tray.test.ts` to assert the new menu item id appears and
flips label with the state.

## WS4 acceptance

- `Ctrl+Shift+M` starts and stops a meeting from anywhere in Windows.
- The tray item mirrors it.
- Holding `Ctrl+Space` mid-meeting still dictates, and the meeting transcript
  resumes afterwards with no lost audio (check the segment timeline for a
  continuous span across the dictation).
- Quitting mid-meeting leaves a row marked `interrupted` with its segments
  intact and a playable `recording.webm`.

---

# WS5: persistence

## 5.1 Edit `src/main/db/migrations.ts`

Append version 2. Do not touch version 1. `foreign_keys = ON` is already set
in `client.ts:21`, so the cascade works.

```ts
  {
    version: 2,
    sql: `
      CREATE TABLE meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        engine_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        language TEXT,
        audio_path TEXT,
        audio_bytes INTEGER NOT NULL DEFAULT 0,
        speaker_count INTEGER NOT NULL DEFAULT 0,
        word_count INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL
      );

      CREATE TABLE meeting_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        source TEXT NOT NULL,
        speaker_key TEXT NOT NULL,
        text TEXT NOT NULL,
        gap INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX meeting_segments_by_meeting
        ON meeting_segments (meeting_id, start_ms);

      CREATE TABLE meeting_speakers (
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker_key TEXT NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (meeting_id, speaker_key)
      );

      CREATE VIRTUAL TABLE meeting_segments_fts USING fts5(
        text,
        content='meeting_segments',
        content_rowid='id'
      );

      CREATE TRIGGER meeting_segments_ai AFTER INSERT ON meeting_segments BEGIN
        INSERT INTO meeting_segments_fts (rowid, text) VALUES (new.id, new.text);
      END;

      CREATE TRIGGER meeting_segments_ad AFTER DELETE ON meeting_segments BEGIN
        INSERT INTO meeting_segments_fts (meeting_segments_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
      END;
    `
  }
```

Segment text is never updated after insert, so no `au` trigger is needed. Say
so in a comment, because the absence is otherwise a question.

## 5.2 Edit `src/main/db/schema.ts`

Add the three Drizzle tables mirroring the SQL above. Follow the existing
naming convention exactly (camelCase property, snake_case column).

## 5.3 New file: `src/main/db/meeting-store.ts`

```ts
export interface MeetingStore {
  createMeeting: (input: {
    title: string;
    engineId: string;
    modelId: string;
    language: string | null;
    audioPath: string | null;
  }) => number;
  appendSegment: (input: Omit<MeetingSegment, "id">) => number;
  finalizeMeeting: (id: number, input: {
    endedAtMs: number;
    durationMs: number;
    audioBytes: number;
    speakerCount: number;
    state: "complete" | "interrupted";
  }) => void;
  setTitle: (id: number, title: string) => boolean;
  setSpeakerLabel: (id: number, speakerKey: string, label: string) => void;
  listMeetings: (limit: number, offset: number) => MeetingRecord[];
  countMeetings: () => number;
  getMeeting: (id: number) => MeetingRecord | null;
  listSpeakers: (id: number) => MeetingSpeaker[];
  listSegments: (id: number, limit: number, offset: number) => MeetingSegment[];
  countSegments: (id: number) => number;
  searchSegments: (query: string, limit: number) => MeetingSearchHit[];
  removeMeeting: (id: number) => boolean;
  /** Meetings still marked recording after a crash. Called once at boot. */
  markInterruptedOnBoot: () => number;
  /** Ids and audio paths older than the cutoff, for the retention sweep. */
  listExpired: (cutoffMs: number) => { id: number; audioPath: string | null }[];
}
```

Reuse `sanitizeFtsQuery` from `history-store.ts` by exporting it there and
importing it here. It exists because FTS5 `MATCH` rejects arbitrary syntax and
the user's input must never be able to break the query; duplicating that
reasoning in two places invites one of them to drift.

`finalizeMeeting` computes `word_count` in SQL over the meeting's segments,
using the same `WORD_COUNT` expression `history-store.ts:61` defines. Export
it from there and import it, for the same reason.

Write `meeting-store.test.ts` against an in-memory `better-sqlite3` database
the way `history-store.test.ts` does. Cover: insert and read back a segment,
FTS search finds it, deleting a meeting cascades its segments and speakers,
`markInterruptedOnBoot` flips only rows in `recording`, and `listSegments`
paginates in timeline order.

## 5.4 Edit `src/main/db/client.ts`

`openDatabase` returns `HistoryStore | null` today. Change it to return
`{ history: HistoryStore; meetings: MeetingStore } | null`, and update the two
call sites in `src/main/index.ts`. One database file, one connection, two
stores over it.

## WS5 acceptance

- A userData directory from v0.3.1 opens, migrates to version 2, and its
  existing transcripts are intact.
- `pnpm test` covers the new store.
- Deleting a meeting from the UI removes its rows and its recording directory.

---

# WS6: the interface

Build against `docs/DESIGN_SYSTEM.md`. Every colour, radius, shadow and easing
comes from the tokens in section 17 of that document. Use the existing
components in `src/renderer/main/components/ui/`: `Card`, `Section`,
`Button`, `IconButton`, `Badge`, `SearchInput`, `EmptyState`, `Dialog`,
`StatusDot`, `ProgressBar`, `Switch`, `SettingsGroup`, `SettingsRow`,
`Tooltip`, `Kbd`. Do not re-type Tailwind that a component already owns.

## 6.1 The route

`src/renderer/main/store/use-main-store.ts`:

```ts
export type Route =
  | "dictate"
  | "meetings"
  | "history"
  | "dictionary"
  | "models"
  | "settings";

export const ROUTE_ORDER: readonly Route[] = [
  "dictate",
  "meetings",
  "history",
  "dictionary",
  "models",
  "settings"
];
```

`ROUTE_LABELS` gains `meetings: "Meetings"`. Add the meeting state and the
live segment tail to the store:

```ts
  meeting: MeetingState;
  setMeeting: (next: MeetingState) => void;
```

`Rail.tsx` and `CommandPalette.tsx` both derive from `ROUTE_ORDER`, so both
pick the route up for free once you add:

- `ROUTE_ICONS.meetings = "ph:users-three"`
- `ROUTE_KEYS.meetings = "nav.meetings"`

in each file. `src/renderer/main/main.tsx:54` already bounds the Ctrl+digit
jump by `ROUTE_ORDER.length`, so Ctrl+1 through Ctrl+6 works with no change.
Update the Ctrl+1..5 wording in `docs/FEATURES.md` and `AGENTS.md` when you
get to the docs pass.

Add a recording indicator to the rail row: when the meeting is active, render
a `StatusDot` in `state-listening` beside the label. The rail is where a user
looks to know something is running.

## 6.2 New file: `src/renderer/main/views/MeetingsView.tsx`

One route, three states, chosen in this order:

1. **Assets missing.** A single `Card` with the three assets, their purpose
   strings, the combined download size from `REQUIRED_ASSET_BYTES`, and one
   primary button. Progress replaces the button while installing, using
   `ProgressBar` and the `meeting:asset-progress` push. This is the same
   honest-setup-step pattern the Models page already uses; do not make it a
   modal.

2. **A meeting is running.** The live view.

3. **Otherwise.** The library.

### The live view

- A header strip: elapsed time (ticking), a recording dot, the two lane
  meters, the stop button, the pause button.
- The lane meters read `meeting:levels` at 10 Hz. Two thin horizontal bars
  labelled with the i18n keys for "System audio" and "Microphone". A lane that
  is not live shows its reason inline, translated from the code, with the fix
  named. Follow the `dictate.blocker.*` copy pattern already in `en.ts`.
- A backlog line, shown only when `backlogSeconds > 5`:
  "Transcribing, {n} seconds behind". Never show it at zero: a status that is
  always on screen stops being read.
- The transcript. Virtualized with `@tanstack/react-virtual`, exactly as
  `HistoryView.tsx` does. Rows arrive by push, appended to a local array; the
  view never re-reads the meeting on every utterance.
- Pinned to the bottom by default. If the user scrolls up, stop auto-scrolling
  and show a "Jump to live" pill. This is not optional: a transcript that
  yanks itself away while you are reading it is unusable.

### Transcript row

Speaker label, timestamp, text. Consecutive rows from the same speaker do not
repeat the label, which is what makes a long transcript readable. Colour the
speaker label by a stable hash of the key into the accent, ember and info
tokens, and never into `state-listening`: verdigris is reserved for recording
and genuine success (DESIGN_SYSTEM section 4).

A `gap` row renders differently: a muted rule with "Not transcribed
({duration})" centred on it. Honest, not hidden.

### The library

- `SearchInput` across every meeting's segments, hitting `meeting:search`.
  Results group by meeting and show the matching line with its timestamp.
- Otherwise a list of meetings, newest first, paged 50 at a time.
- Each row: title, date, duration, speaker count, word count, and a size badge
  when a recording exists. Actions on hover, following `TranscriptRow`:
  open, export, reveal recording, delete (two-step, as History does).
- Empty state via `EmptyState`, with the hotkey in a `Kbd`.

### Detail view

Reached by clicking a meeting. Same transcript component as the live view,
reading from `meeting:segments` with pagination, plus:

- Inline rename of the title.
- A speakers panel: one row per key with an editable label, saving through
  `meeting:rename-speaker`. Renaming updates every row on screen immediately,
  because the label is resolved at render time from the speakers map, not
  baked into the segment.
- Export buttons.

Keep the detail view in the same route rather than adding a router; hold the
selected meeting id in the store as `meetingDetailId: number | null`, and let
`AnimatePresence` slide between library and detail using the same
`PAGE_VARIANTS` shape `App.tsx` uses.

## 6.3 New file: `src/renderer/main/views/settings/MeetingsTab.tsx`

A seventh tab in `SettingsView.tsx`. Groups, using `SettingsGroup` and
`SettingsRow`:

- **Recording**: meeting hotkey (`HotkeyRecorder`), include microphone
  (`Switch`), keep the audio recording (`Switch`), archive quality
  (`SegmentedControl`: 16 / 32 / 64 kbps, with the per-hour size beneath).
- **Transcription**: engine (`Select`, Parakeet or Whisper only, with a note
  saying cloud engines are not offered for meetings and why), speech language
  reuses the existing setting.
- **Speakers**: label speakers (`Switch`), sensitivity (`Slider` over
  `speakerThreshold`, labelled "Merge similar voices" to "Keep voices apart"
  rather than showing a cosine number), expected speakers (`NumberInput`, 0
  meaning automatic).
- **Advanced**, behind a `Disclosure` as the other tabs do: the three VAD
  values, `diarizationRefineOverMs`, `autoStopSilentMinutes`,
  `retentionDays`.

Every write sends the whole `meeting` object, because `SettingsStore.update`
is a shallow merge.

## 6.4 The live bar on Dictate

When a meeting is running, `DictateView` gains one compact bar at the top:
recording dot, elapsed time, "Meetings" link, stop button. It must be
impossible to forget that the machine is recording. Reuse the header strip
component from the live view so there is one implementation.

## 6.5 i18n

Add every new key to `src/shared/i18n/locales/en.ts`, which is the source of
truth that `MessageKey` derives from. Then add the same keys to `de`, `es`,
`fr`, `it`, `nl`, `pl`, `pt-BR`. `src/shared/i18n/i18n.test.ts` should already
fail on a locale that is missing a key; if it does not, add that assertion,
because eight catalogs drifting silently is a real risk with a feature this
size.

Key groups to add: `nav.meetings`, `meetings.*` (roughly 60 keys),
`settings.meetings.*`, `tray.startMeeting`, `tray.stopMeeting`.

Main never sends translated strings to the renderer. Every failure crosses IPC
as a code from `MeetingLaneErrorCode` or `MeetingErrorCode` and is translated
in the renderer. That rule is AGENTS.md section 15 and it is not negotiable.

## WS6 acceptance

- Ctrl+6 reaches Meetings, Ctrl+K finds it, the rail shows it.
- A three minute meeting produces a readable, correctly attributed transcript
  that scrolls smoothly and stays pinned to live.
- Renaming a speaker updates every line at once.
- Every string on screen is translated in `nl` when the UI language is Dutch.

---

# WS7: export

New file `src/main/meeting/export.ts`, pure functions over
`MeetingRecord`, `readonly MeetingSegment[]` and
`readonly MeetingSpeaker[]`. No filesystem, no Electron: the IPC handler does
the dialog and the write, the same split
`dictionaryExportChannel` uses.

Three formats:

- `markdown`: an H1 title, a metadata line (date, duration, speakers), then
  `**Sarah** _(12:04)_` followed by the text, blank line between turns.
- `text`: `[12:04] Sarah: text`, one line per turn.
- `srt`: numbered cues with `HH:MM:SS,mmm --> HH:MM:SS,mmm`, speaker prefixed
  into the cue text.

Speaker labels resolve from the speakers map, falling back to
`defaultSpeakerLabel`. Gap rows render as `[not transcribed]` in text and
markdown, and are skipped entirely in SRT.

Unit test each format against a fixture of five segments and two speakers,
including a gap row and a segment crossing the one hour mark (the SRT
timestamp formatter is where that breaks).

---

# Test plan

## Unit tests to write

| File | Covers |
|---|---|
| `src/shared/meeting.test.ts` | `isMeetingActive`, `defaultSpeakerLabel` |
| `src/shared/settings.test.ts` (extend) | a v0.3.1 settings file gains meeting defaults |
| `src/shared/ipc-arguments.test.ts` (extend) | the new preload channel keys survive serialisation |
| `src/main/meeting/worker/vad-lane.test.ts` | window carry, absolute sample indices, silent lane |
| `src/main/meeting/worker/speaker-clusterer.test.ts` | the five cases in WS3.3 |
| `src/main/meeting/meeting-session.test.ts` | start refusals, the stop ordering, dictation yielding, auto-stop |
| `src/main/meeting/archive-writer.test.ts` | queued appends, byte count on close, a failing open |
| `src/main/meeting/export.test.ts` | three formats, gap rows, the one hour boundary |
| `src/main/db/meeting-store.test.ts` | insert, FTS, cascade, interrupted-on-boot, pagination |
| `src/main/tray.test.ts` (extend) | the meeting menu item and its label flip |

`meeting-session.test.ts` is the important one. Inject fakes for the worker,
the window, the archive and the store, and drive the session through every
transition. It should never touch a native module or a real window, exactly as
`capture-session.test.ts` does not.

## E2E

Do **not** write e2e specs for this unprompted, and do not run `pnpm test:e2e`.
When the user asks, the spec worth writing is `e2e/meeting.spec.ts` driving
the session through the test hook with a simulated audio source, asserting the
state broadcast sequence and a written meeting row. Loopback cannot be
exercised headlessly, so the audio itself stays a manual check.

## Manual checklist

1. Start a meeting with Teams playing. Confirm remote voices are transcribed
   and your own microphone lines are labelled You.
2. Two remote speakers get distinct labels within their first few turns.
3. Dictate with `Ctrl+Space` mid-meeting. The transcript resumes with no gap
   in the timeline.
4. Unplug the headphones mid-meeting. The system lane reports device-changed
   and recovers.
5. Leave a meeting running for 90 minutes. Watch RAM in Task Manager for both
   the main process and the `struq-meeting` utility process; neither should
   trend upward after the first ten minutes.
6. Kill the utility process from Task Manager. The app stays up, dictation
   works, the meeting is marked interrupted.
7. Quit the app mid-meeting. Reopen. The meeting shows as interrupted with its
   segments and a playable recording.
8. Export all three formats and open each.

---

# Performance budget and how to verify it

These are the numbers the implementation must hold. If a change breaks one of
them, the change is wrong.

| Property | Budget | How to check |
|---|---|---|
| Main process CPU while a meeting runs | under 2 percent | Task Manager, main process only |
| Worker CPU, one speaker active | under 25 percent of one core | Task Manager, `struq-meeting` |
| Main process RSS growth over 90 minutes | under 50 MB | Task Manager |
| Worker RSS after warmup | flat within 100 MB | Task Manager |
| Audio in flight, per lane | 32 KB per second, never accumulating | code review: no array grows without a bound |
| Disk per hour of meeting | about 14 MB at 32 kbps | stat the recording |
| Dictation latency during a meeting | unchanged from idle | time key-release to paste, ten samples each way |
| Transcript lag behind live speech | under 3 seconds typical | watch the live view |

The structural guarantees behind them, each of which is worth checking in
review:

1. No array in the renderer, in main, or in the worker grows with meeting
   length. The only unbounded things are SQLite rows and one opus file.
2. The worker's queue has a hard cap and a defined behaviour at the cap.
3. Main never holds audio. It forwards frames and appends archive bytes.
4. Silence is never decoded, because VAD gates every utterance.
5. There is exactly one timer in the meeting audio renderer, at 10 Hz, and the
   window disables background throttling so it is honest.
6. `setImmediate` between decodes keeps the worker's event loop responsive
   while a blocking native call is the main workload.

---

# Deliberately not in scope

State these in the PR description so nobody thinks they were missed.

- **Cloud engines for meetings.** Hours of audio to a paid API is a bill and a
  disclosure nobody agreed to. Local only, enforced by the settings enum.
- **Cross-meeting speaker identity.** Speakers are per meeting. Enrolling
  "Sarah" once and having her recognised in every future meeting needs a
  persistent voiceprint store and a consent conversation. `SpeakerEmbeddingManager`
  exists in the sherpa binding for whoever picks this up.
- **Re-transcribing a gap from the archive.** The recording has the audio, so
  it is possible, but it needs an opus decode path that does not exist yet.
- **Summarisation.** Out of scope entirely.
- **Per-application capture.** Electron's loopback captures the whole render
  endpoint, not one process. Capturing only Teams needs process loopback,
  which Electron does not expose.
- **macOS or Linux.** `audio: "loopback"` is Windows only, per the Electron
  typings. The product is Windows 11 x64 anyway.
- **Muxing separate lane files.** One mixed archive is what ships.

---

# Docs to update when the code is green

- `docs/FEATURES.md`: a Meetings section under Built, and the Ctrl+1..5
  correction to Ctrl+1..6.
- `AGENTS.md`: the architecture diagram gains the meeting window and the
  worker; the key files table gains the four new directories; section 5 gains
  a pointer to the meeting state machine.
- `docs/ARCHITECTURE.md`: the process model diagram, and a short section on
  why the ASR runs out of process.
- `docs/MODELS.md`: the meeting assets, their sizes and where they install.
- `.claude/skills/` and `.agents/skills/`: a new `meeting-pipeline` skill
  mirroring `capture-session`, so a cold session does not have to rediscover
  the lane split and the yielding rule.

---

# Final gate checklist

```bash
pnpm typecheck    # tsc across node, web and e2e configs
pnpm lint         # eslint, strictTypeChecked
pnpm test         # vitest, existing 106 plus roughly 45 new
pnpm build        # confirm out/main/meeting-worker.cjs exists
```

Then the boot smoke from AGENTS.md section 7, and kill strays:

```bash
taskkill //F //IM electron.exe
taskkill //F //IM "Struq Voice.exe"
```

Do not run `pnpm test:e2e`. The user runs it.

Commit in slices, conventional commits, one concern each. A reasonable
sequence:

1. `feat(shared): meeting contracts, settings and IPC channels`
2. `refactor(models): extract DownloadBundle so meeting assets reuse the downloader`
3. `feat(db): meetings, segments and speakers tables`
4. `feat(meeting): loopback and microphone capture window`
5. `feat(meeting): transcription worker with VAD and speaker clustering`
6. `feat(meeting): session, hotkey and tray wiring`
7. `feat(ui): meetings route, live transcript and library`
8. `feat(meeting): markdown, text and SRT export`
9. `docs: meetings`

Scan every file you touched for U+2014, U+2013 and U+2015 before the final
commit. A grep that spells the codepoints rather than pasting the characters
keeps the check itself clean:

```bash
rg -n "\x{2014}|\x{2013}|\x{2015}" src docs AGENTS.md CLAUDE.md
```

It must print nothing. Writing the codepoints as escapes rather than pasting
the characters is what keeps the check itself clean, and it is why this
document is pure ASCII.
