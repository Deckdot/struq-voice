/**
 * Engine ids shared by main and renderer. The full catalog with download URLs
 * lives in src/shared/models.ts (Phase 5); this holds the ids every surface
 * needs today.
 */

export const MOCK_ENGINE_ID = "mock" as const;

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

/**
 * Every engine the user can select, described once. Both Dictate and
 * Settings render from this, so an engine cannot be labelled two ways.
 * Ordered as a user should consider them: local first, cloud second, and the
 * test engine last because it is not a real choice.
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
  },
  {
    id: MOCK_ENGINE_ID,
    displayName: "Mock",
    kind: "test",
    hint: "Returns fixed text without transcribing. For development only."
  }
];

export const engineOption = (id: string): EngineOption | null =>
  ENGINE_OPTIONS.find((option) => option.id === id) ?? null;
