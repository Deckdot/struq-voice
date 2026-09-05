/**
 * OpenRouter STT engine, ported from StruqADE voice-service.ts:199-365 and
 * adapted to plan section 5.5: OpenAI-compatible transcriptions endpoint,
 * openai/whisper-large-v3 primary with openai/whisper-1 retry on retryable
 * statuses, cost reported per transcription.
 *
 * Length is not a limit here. The endpoint caps the size of one request, not
 * the length of a dictation, so a recording past that size is cut into pieces
 * at its own pauses and sent as several requests whose transcripts are joined
 * back together. The old hard refusal above sixty seconds was ours, not the
 * provider's, and it turned any real dictation into an error message.
 */

import { DEFAULT_CHUNK_PLAN, planChunks } from "../audio/chunking";
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
export const OPENROUTER_PRIMARY_MODEL_ID = "openai/whisper-large-v3" as const;
const PRIMARY_MODEL = OPENROUTER_PRIMARY_MODEL_ID;
const FALLBACK_MODEL = "openai/whisper-1";
/** The provider's own per-request ceiling. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const SAMPLE_RATE = 16_000;
/**
 * 16kHz mono Int16 is 32kB per second, so 25MB is roughly thirteen minutes.
 * Chunks are planned well under that: a smaller upload fails faster, retries
 * cheaper, and leaves headroom for the base64 the request body carries.
 */
const CHUNK_PLAN = DEFAULT_CHUNK_PLAN;

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

/** Matches what `fetch` throws on an aborted request, so one branch reads both. */
const abortError = (): Error => {
  const error = new Error("Transcription was cancelled.");
  error.name = "AbortError";
  return error;
};

class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

interface ChunkOutcome {
  readonly text: string;
  readonly language: string | null;
  readonly modelId: string;
  readonly costUsd: number | null;
}

/**
 * One request. The retryable-status retry with the smaller model stays per
 * chunk rather than per recording: a 429 on the fourth chunk of six should
 * cost that chunk a retry, not re-upload everything that already succeeded.
 */
const transcribeChunk = async (
  apiKey: string,
  pcm: Int16Array,
  language: string | undefined,
  signal: AbortSignal
): Promise<ChunkOutcome> => {
  const wav = buildWav(pcm, SAMPLE_RATE);
  if (wav.byteLength > MAX_AUDIO_BYTES) {
    // The chunk plan keeps every request an order of magnitude under this, so
    // reaching it means the plan and the provider limit have drifted apart.
    throw new OpenRouterError(
      "This part of the recording is too large for OpenRouter to accept.",
      413
    );
  }
  const read = (payload: OpenRouterResponse, modelId: string): ChunkOutcome => ({
    text: payload.text?.trim() ?? "",
    language: payload.detected_language ?? payload.language ?? language ?? null,
    modelId,
    costUsd: payload.usage?.cost ?? null
  });

  try {
    return read(
      await callOpenRouter(apiKey, PRIMARY_MODEL, wav, language, signal),
      PRIMARY_MODEL
    );
  } catch (primaryError) {
    if (primaryError instanceof OpenRouterError && isRetryable(primaryError.status)) {
      return read(
        await callOpenRouter(apiKey, FALLBACK_MODEL, wav, language, signal),
        FALLBACK_MODEL
      );
    }
    throw primaryError;
  }
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

      const chunks = planChunks(request.pcm, {
        sampleRate: SAMPLE_RATE,
        ...CHUNK_PLAN
      });
      if (chunks.length === 0) {
        return fail({
          code: "INVALID_REQUEST",
          message: "There is no audio to transcribe."
        });
      }

      const startedAt = Date.now();
      const parts: string[] = [];
      let language: string | null = null;
      let costUsd: number | null = null;
      let modelId: string = PRIMARY_MODEL;
      let failure: unknown = null;

      for (const chunk of chunks) {
        if (request.signal.aborted) {
          failure = abortError();
          break;
        }
        try {
          const outcome = await transcribeChunk(
            apiKey,
            request.pcm.subarray(chunk.start, chunk.end),
            request.language,
            request.signal
          );
          if (outcome.text.length > 0) parts.push(outcome.text);
          language ??= outcome.language;
          if (outcome.costUsd !== null) costUsd = (costUsd ?? 0) + outcome.costUsd;
          modelId = outcome.modelId;
        } catch (error) {
          failure = error;
          break;
        }
      }

      // A chunk that fails partway through a long recording used to discard
      // every chunk that had already come back. Four minutes of a five minute
      // dictation is worth far more than an error message, so what did arrive
      // is delivered and only a total loss is reported as a failure.
      const text = parts.join(" ").trim();
      if (text.length === 0) {
        return fail(
          failure !== null
            ? { code: "UNKNOWN", message: humaniseError(failure) }
            : {
                code: "UNKNOWN",
                message:
                  "Transcription returned empty text. Check your audio and try again."
              }
        );
      }

      const inferenceMs = Date.now() - startedAt;
      return ok({
        text,
        language,
        engineId: OPENROUTER_ENGINE_ID,
        modelId,
        inferenceMs,
        realtimeFactor:
          request.durationMs > 0 ? inferenceMs / request.durationMs : 0,
        costUsd
      });
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
