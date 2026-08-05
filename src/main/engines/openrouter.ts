/**
 * OpenRouter STT engine, ported from StruqADE voice-service.ts:199-365 and
 * adapted to plan section 5.5: OpenAI-compatible transcriptions endpoint,
 * openai/whisper-large-v3 primary with openai/whisper-1 retry on retryable
 * statuses, 25MB cap enforced up front, cost reported per transcription.
 */

import { buildWav } from "../audio/wav";
import type { Result } from "../../shared/result";
import { fail, ok } from "../../shared/result";
import type {
  EngineReadiness,
  TranscribeRequest,
  TranscribeResult,
  TranscriptionEngine
} from "./types";

const OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const PRIMARY_MODEL = "openai/whisper-large-v3";
const FALLBACK_MODEL = "openai/whisper-1";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 60;

const isRetryable = (status: number): boolean =>
  [408, 409, 429, 500, 502, 503, 504].includes(status);

export interface OpenRouterEngineInput {
  readonly getApiKey: () => Promise<string | null>;
}

export const OPENROUTER_ENGINE_ID = "openrouter";

interface OpenRouterResponse {
  readonly text?: string;
  readonly language?: string;
  readonly detected_language?: string;
  readonly usage?: {
    readonly seconds?: number;
    readonly cost?: number;
  };
}

const callOpenRouter = async (
  apiKey: string,
  model: string,
  wav: Buffer,
  language: string | undefined,
  signal: AbortSignal
): Promise<OpenRouterResponse> => {
  const body = {
    model,
    ...(language !== undefined ? { language } : {}),
    input_audio: {
      data: wav.toString("base64"),
      format: "wav"
    },
    temperature: 0
  };

  const response = await fetch(OPENROUTER_STT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const errorPayload = (await response
      .json()
      .catch(() => null)) as { error?: { message?: string } } | null;
    throw new OpenRouterError(
      errorPayload?.error?.message ??
        `OpenRouter returned status ${String(response.status)}`,
      response.status
    );
  }

  return (await response.json()) as OpenRouterResponse;
};

class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const toResult = (
  payload: OpenRouterResponse,
  engineId: string,
  modelId: string,
  fallbackUsed: boolean,
  durationMs: number,
  language: string | undefined,
  startedAt: number
): Result<TranscribeResult> => {
  const text = payload.text?.trim() ?? "";
  if (text.length === 0) {
    return fail({
      code: "UNKNOWN",
      message: "Transcription returned empty text. Check your audio and try again."
    });
  }
  const inferenceMs = Date.now() - startedAt;
  return ok({
    text,
    language: payload.detected_language ?? payload.language ?? language ?? null,
    engineId,
    modelId,
    inferenceMs,
    realtimeFactor: durationMs > 0 ? inferenceMs / durationMs : 0,
    costUsd: payload.usage?.cost ?? null
  });
};

export const createOpenRouterEngine = (
  input: OpenRouterEngineInput
): TranscriptionEngine => {
  return {
    id: OPENROUTER_ENGINE_ID,
    displayName: "OpenRouter Whisper",
    kind: "cloud",
    readiness: async (): Promise<EngineReadiness> => {
      const apiKey = await input.getApiKey();
      if (apiKey !== null && apiKey.length > 0) {
        return { ready: true };
      }
      return {
        ready: false,
        reason:
          "No OpenRouter API key. Add one in Settings to use cloud transcription.",
        action: "set-api-key"
      };
    },
    warmup: async (): Promise<void> => {},
    transcribe: async (
      request: TranscribeRequest
    ): Promise<Result<TranscribeResult>> => {
      const apiKey = await input.getApiKey();
      if (apiKey === null || apiKey.length === 0) {
        return fail({
          code: "APP_NOT_READY",
          message:
            "No OpenRouter API key. Add one in Settings to use cloud transcription."
        });
      }

      if (request.pcm.byteLength > MAX_AUDIO_BYTES) {
        return fail({
          code: "INVALID_REQUEST",
          message:
            "This recording exceeds the 25MB OpenRouter limit. Record a shorter take."
        });
      }
      if (request.durationMs > MAX_AUDIO_SECONDS * 1000) {
        return fail({
          code: "INVALID_REQUEST",
          message:
            "This recording exceeds the 60 second OpenRouter limit. Record a shorter take."
        });
      }

      const wav = buildWav(request.pcm, 16_000);
      const startedAt = Date.now();

      try {
        const payload = await callOpenRouter(
          apiKey,
          PRIMARY_MODEL,
          wav,
          request.language,
          request.signal
        );
        return toResult(
          payload,
          OPENROUTER_ENGINE_ID,
          PRIMARY_MODEL,
          false,
          request.durationMs,
          request.language,
          startedAt
        );
      } catch (primaryError) {
        // Retry with the fallback model on retryable failures.
        if (primaryError instanceof OpenRouterError && isRetryable(primaryError.status)) {
          try {
            const fallbackPayload = await callOpenRouter(
              apiKey,
              FALLBACK_MODEL,
              wav,
              request.language,
              request.signal
            );
            return toResult(
              fallbackPayload,
              OPENROUTER_ENGINE_ID,
              FALLBACK_MODEL,
              true,
              request.durationMs,
              request.language,
              startedAt
            );
          } catch (fallbackError) {
            return fail({
              code: "UNKNOWN",
              message: humaniseError(fallbackError)
            });
          }
        }
        return fail({
          code: "UNKNOWN",
          message: humaniseError(primaryError)
        });
      }
    },
    dispose: async (): Promise<void> => {}
  };
};

const humaniseError = (error: unknown): string => {
  if (error instanceof Error && error.name === "AbortError") {
    return "Transcription timed out. Check your connection and try again.";
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Transcription failed (${message}). Check your connection and try again.`;
};
