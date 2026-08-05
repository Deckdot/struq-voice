/**
 * The mock engine: instant, deterministic, no model. Used for tests and as
 * the bootstrap default until a real engine is configured.
 */

import { MOCK_ENGINE_ID, MOCK_TRANSCRIPT } from "../../shared/engines";
import type { Result } from "../../shared/result";
import type {
  EngineReadiness,
  TranscribeRequest,
  TranscribeResult,
  TranscriptionEngine
} from "./types";

export const createMockEngine = (): TranscriptionEngine => {
  return {
    id: MOCK_ENGINE_ID,
    displayName: "Mock",
    kind: "local",
    readiness: (): Promise<EngineReadiness> => Promise.resolve({ ready: true }),
    warmup: (): Promise<void> => Promise.resolve(),
    transcribe: (request: TranscribeRequest): Promise<Result<TranscribeResult>> => {
      const inferenceMs = 1;
      return Promise.resolve({
        ok: true,
        value: {
          text: MOCK_TRANSCRIPT,
          language: request.language ?? null,
          engineId: MOCK_ENGINE_ID,
          modelId: "mock-v1",
          inferenceMs,
          realtimeFactor: request.durationMs > 0 ? inferenceMs / request.durationMs : 0,
          costUsd: null
        }
      });
    },
    dispose: (): Promise<void> => Promise.resolve()
  };
};
