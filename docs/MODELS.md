# Struq Voice models

Struq Voice ships with a local transcription story and a cloud escape hatch.
This page describes the models the app can run, where they live, and how the
download pipeline behaves.

## Engines at a glance

| Engine | Id | Kind | When to use it |
|---|---|---|---|
| Parakeet TDT | `parakeet` | local (sherpa-onnx) | Default. Fast, 25 European languages, fully offline |
| Whisper.cpp | `whisper-cpp` | local (sidecar process) | Non-European languages, heavy accents, poor recordings |
| OpenRouter Whisper | `openrouter` | cloud | Zero-setup path; needs an API key; audio leaves the machine |
| Mock | `mock` | test | Deterministic fake transcripts, development only |

## Parakeet (default, local)

`sherpa-onnx-node` runs NVIDIA's Parakeet TDT transducers offline through the
ONNX runtime.

| Model | Size | Languages |
|---|---:|---|
| `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` | ~670MB | 25 European incl. English, Dutch, German, French, Spanish |
| `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` | ~661MB | English only, better punctuation and casing |

**Warmup is mandatory and automatic.** Loading the int8 encoder takes 1-3
seconds, so the app warms the model in the background at start, before the
first hotkey press. The tray tooltip shows the warm state. Warmup is skipped
in test modes because the sherpa native load is the exact kind of native
interference the keyboard-hook spec isolates against.

Download URLs and sha256 hashes come from the Hugging Face repos:

- `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`
- `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8`

## Whisper.cpp (local, GPU-capable)

whisper.cpp runs as a sidecar process (`whisper-cli.exe`), not a Node binding,
so a crash inside the model cannot take the app down and swapping in a faster
build is trivial.

The full ggml catalog is available, 29 builds from tiny to large. Sizes and
sha256 hashes are taken from the Hugging Face API tree for
`ggerganov/whisper.cpp`, so every file is verifiable.

| Tier | Range | When to use it |
|---|---:|---|
| tiny | 32 to 78MB | Fastest and smallest. Draft quality |
| base | 60 to 148MB | Light and quick, fine for clear speech |
| small | 190 to 488MB | The usual sweet spot |
| medium | 539MB to 1.5GB | High accuracy, slower, more RAM |
| large | 574MB to 3.1GB | Best accuracy, slowest |

Each tier offers quantised builds (`q5_1`, `q5_0`, `q8_0`) and the
full-precision weights. Quantised trades a little accuracy for a much smaller
download; `q8_0` is the closest to full. English-only builds (`.en`) are
better at English and useless for anything else. The Models view filters by
tier and by English-only so the list stays navigable.

The default is `whisper-base-q5_1` (60MB): multilingual, and comfortable on
any machine before the user has picked a size. Change it in
Settings > Whisper model, which writes `whisperModelId`. The engine reads that
setting per transcription, so a change applies without a restart.

The **runtime** is `whisper-cli.exe`, the CPU build from the whisper.cpp
v1.9.2 release. It **installs automatically in the background on first run**,
so selecting the engine works without a manual step; the button in the Models
view remains as the retry path if that install failed. The runtime is a zip,
downloaded and sha256-verified, then only `whisper-cli.exe` is extracted into
`userData/runtimes/whisper-cpp/`. A failed install never blocks boot: it
leaves an error the Models view renders. If the CUDA build cannot start
(missing runtime DLLs), the engine falls back to CPU and says so once.

Models themselves still download on demand from the Models view; only the
runtime is automatic.

## Measured speed

The Models view reports a realtime factor **measured on this machine**, not a
static claim: after the first capture on an engine, `inferenceMs / durationMs`
is averaged over recent History rows and shown on every model card of that
engine.

## Download pipeline

- Storage: `userData/models/<model-id>/` for verified files.
- Partial downloads live in `.partial/` and resume with HTTP range requests
  across restarts.
- At most three files download concurrently across all models.
- Every file is sha256-verified before it is atomically renamed into place.
- Progress is reported at 4Hz; cancellation keeps the partial so a later
  retry resumes instead of restarting.
- **Import:** a model already present on disk can be imported from its folder
  in the Models view. Files are copied and then verified against the catalog
  hashes; a mismatch is reported rather than silently accepted.

## Meeting support assets

Meetings need three ONNX models beyond the ASR engine: a Silero voice
activity detector, a CAM++ speaker embedding extractor, and a pyannote
speaker segmentation model. They are defined in
`src/shared/meeting-assets.ts` (sizes and sha256 from the Hugging Face API),
deliberately separate from `models/` so the Models view's disk total keeps
meaning "transcription models".

**These ship with the installer.** `scripts/vendor-meeting-assets.mjs` fetches
and sha256-verifies them into `resources/meeting-assets/`, and
`electron-builder.yml` carries that directory as `extraResources`, so a
packaged install resolves them from `process.resourcesPath` and downloads
nothing. `build-installer.mjs` runs the vendor step before packaging, so an
installer cannot be produced without them.

The user is never told any of this. Which models a meeting uses, how many
there are and what each weighs is not something anybody opens the app to
learn, and naming them invites a decision the user has no basis to make. The
onnx files are gitignored, so a fresh checkout fetches them on the first
build.

| Asset | File | Size | Required |
|---|---|---|---|
| Silero VAD | `silero_vad.onnx` | 1.8 MB | yes |
| CAM++ embedding | `3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx` | 29.6 MB | yes |
| Pyannote segmentation | `model.onnx` | 6.0 MB | no |

They never appear in `MODEL_CATALOG`, so the Models view stays a page about
transcription quality.

The resumable downloader (the `DownloadBundle` interface in
`src/shared/models.ts` is the shared structural part) remains as the repair
path only: a dev checkout that has not vendored them, or an install whose
files went missing. It writes to `userData/meeting-assets/` and starts on its
own when the Meetings tab opens, with a card that says it is setting up and
nothing more. A bundled copy always wins over a fetched one, so a repair
cannot shadow the file the build shipped.

Bundling costs about 36 MB in the installer, roughly a third of it. Because
the files are pinned by hash and do not change between versions, the
differential updater skips every one of their blocks on subsequent updates,
so the cost is paid once at first install rather than on every update.

## OpenRouter (cloud)

`POST https://openrouter.ai/api/v1/audio/transcriptions` with
`openai/whisper-large-v3` (primary) and `openai/whisper-1` (fallback on
retryable statuses 408, 409, 429, 500, 502, 503, 504). Caps at 25MB and 60s of
audio. Per-transcription cost is recorded in History.

The API key lives in `userData/secrets/openrouter.enc`, encrypted with
Electron `safeStorage` (DPAPI on Windows). The raw key never crosses IPC; the
Settings view shows a masked placeholder and a Replace-key action only.
Resolution order: stored key, then `OPENROUTER_API_KEY`, then unconfigured.

## Engine selection

The first engine to become ready wins the bootstrap default:

1. Parakeet becomes the primary once its model is downloaded.
2. Otherwise OpenRouter once an API key exists.
3. Otherwise the mock stays until the user chooses in Settings.

`STRUQ_VOICE_ENGINE` overrides everything and forces a specific engine id.
