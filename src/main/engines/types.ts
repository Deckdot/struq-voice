/**
 * The transcription engine contract, per plan section 5.5. Local engines
 * drop in behind this interface; the router decides who runs.
 */

import type { Result } from "../../shared/result";

export interface TranscribeRequest {
  /** Int16 PCM, 16kHz mono. */
  readonly pcm: Int16Array;
  readonly durationMs: number;
  /** ISO-639-1 language hint; omit for auto-detect. */
  readonly language?: string;
  readonly signal: AbortSignal;
}

export interface TranscribeResult {
  readonly text: string;
  readonly language: string | null;
  readonly engineId: string;
  readonly modelId: string;
  readonly inferenceMs: number;
  readonly realtimeFactor: number;
  readonly costUsd: number | null;
}

export interface EngineReadiness {
  readonly ready: boolean;
  /** User-facing, names cause AND fix. */
  readonly reason?: string;
  readonly action?: "download-model" | "set-api-key" | "install-runtime";
}

export interface TranscriptionEngine {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "local" | "cloud";
  readiness: () => Promise<EngineReadiness>;
  /** Idempotent background warmup, called at app start. */
  warmup: () => Promise<void>;
  transcribe: (request: TranscribeRequest) => Promise<Result<TranscribeResult>>;
  dispose: () => Promise<void>;
}
