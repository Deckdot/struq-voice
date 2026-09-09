/**
 * Engine ids shared by main and renderer. The full catalog with download URLs
 * lives in src/shared/models.ts (Phase 5); this holds the ids every surface
 * needs today.
 */

export const MOCK_ENGINE_ID = "mock" as const;

/**
 * The default engine for a new profile. Declared here rather than imported
 * from the engine implementation, because shared must not reach into main.
 * The implementation exports the same literal and the two are pinned together
 * by a test in engines.test.ts.
 */
export const DEFAULT_ENGINE_ID = "parakeet" as const;

export interface EngineDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "local" | "cloud" | "test";
}

export const MOCK_ENGINE: EngineDescriptor = {
  id: MOCK_ENGINE_ID,
  displayName: "Mock",
  kind: "test"
};

/** The mock engine's deterministic output; also the e2e contract. */
export const MOCK_TRANSCRIPT =
  "This is a mock transcription. Configure an engine to replace it.";

export interface EngineOption extends EngineDescriptor {
  /** One line on what picking this costs and buys. */
  readonly hint: string;
}

export interface OpenRouterTranscriptionModel {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  readonly endpoint: "audio-transcriptions" | "stt";
}

/** Curated STT models exposed by the OpenRouter provider. Keep this list small. */
export const OPENROUTER_TRANSCRIPTION_MODELS: readonly OpenRouterTranscriptionModel[] = [
  {
    id: "openai/gpt-transcribe",
    name: "GPT Transcribe",
    hint: "OpenAI's latest high-accuracy speech recognition model.",
    endpoint: "audio-transcriptions"
  },
  {
    id: "microsoft/mai-transcribe-2",
    name: "MAI-Transcribe 2",
    hint: "Microsoft multilingual transcription with fast long-form processing.",
    endpoint: "audio-transcriptions"
  },
  {
    id: "x-ai/grok-stt-1.0",
    name: "Grok STT 1.0",
    hint: "Fast xAI speech-to-text with optional diarization.",
    endpoint: "stt"
  },
  {
    id: "qwen/qwen3-asr-1.7b",
    name: "Qwen3 ASR 1.7B",
    hint: "Accurate multilingual speech recognition with fast inference.",
    endpoint: "audio-transcriptions"
  },
  {
    id: "openai/whisper-large-v3-turbo",
    name: "Whisper Large V3 Turbo",
    hint: "Very fast broad-language transcription with low cost.",
    endpoint: "audio-transcriptions"
  }
];

export const DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL =
  OPENROUTER_TRANSCRIPTION_MODELS[0]?.id ?? "openai/gpt-transcribe";

/**
 * Every engine the user can select, described once. Both Dictate and
 * Settings render from this, so an engine cannot be labelled two ways.
 * Ordered as a user should consider them: local first, cloud second.
 *
 * The mock is deliberately absent. It is registered by main only under the
 * e2e flags, so listing it here would offer a choice that a packaged build
 * cannot honour.
 */
export const ENGINE_OPTIONS: readonly EngineOption[] = [
  {
    id: "parakeet",
    displayName: "Parakeet TDT",
    kind: "local",
    hint: "25 European languages. Fast, and nothing leaves this machine."
  },
  {
    id: "whisper-cpp",
    displayName: "Whisper.cpp",
    kind: "local",
    hint: "99 languages and difficult recordings. Sizes from 60MB to 3GB."
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    kind: "cloud",
    hint: "No download and no local load. Needs an API key, and audio leaves the machine."
  }
];

export const engineOption = (id: string): EngineOption | null =>
  ENGINE_OPTIONS.find((option) => option.id === id) ?? null;
