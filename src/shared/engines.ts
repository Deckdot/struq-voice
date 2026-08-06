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
