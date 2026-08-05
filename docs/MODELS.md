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

| Model | Size | Notes |
|---|---:|---|
| `ggml-large-v3-turbo-q5_0.bin` | ~574MB | Default whisper model |
| `ggml-base.bin` | ~148MB | Light option |

The **runtime** (`whisper-cli.exe`, CPU build from the whisper.cpp v1.9.2
release) and the model both download on demand from the Models view. The
runtime is a zip, downloaded and sha256-verified, then only `whisper-cli.exe`
is extracted into `userData/runtimes/whisper-cpp/`. If the CUDA build cannot
start (missing runtime DLLs), the engine falls back to CPU and says so once.

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
