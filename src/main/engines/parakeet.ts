/**
 * The local Parakeet STT engine via sherpa-onnx-node. The native addon is
 * required lazily so this module loads even when the addon is missing;
 * readiness and transcribe then report the install step instead of crashing.
 * The engine takes injected options only and never reads the settings store.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { findModel, PARAKEET_DEFAULT_MODEL_ID } from "../../shared/models";
import type { Result, VoiceError, VoiceErrorCode } from "../../shared/result";
import { fail, ok } from "../../shared/result";
import type {
  EngineReadiness,
  TranscribeRequest,
  TranscribeResult,
  TranscriptionEngine
} from "./types";

export const PARAKEET_ENGINE_ID = "parakeet" as const;
export { PARAKEET_DEFAULT_MODEL_ID };

const DEFAULT_NUM_THREADS = 8;
const SAMPLE_RATE = 16_000;
const FEATURE_DIM = 80;
/**
 * How long a failed native load or recognizer construction stays latched.
 * Transient corporate failures (AV scanning a DLL, blocked DLL load) must
 * not kill Parakeet until restart; after this window the next capture tries
 * again and the engine heals itself.
 */
const LOAD_RETRY_MS = 60_000;

const NOT_INSTALLED_MESSAGE =
  "Parakeet runtime is not installed. Install it in Settings > Models.";
const NOT_DOWNLOADED_MESSAGE =
  "Parakeet model is not downloaded. Download it in Settings > Models.";

export interface SherpaWaveform {
  readonly samples: Float32Array | readonly number[];
  readonly sampleRate: number;
}

export interface SherpaOfflineStream {
  acceptWaveform: (obj: SherpaWaveform) => void;
}

export interface SherpaOfflineRecognizerResult {
  readonly text?: string;
}

export interface SherpaOfflineRecognizer {
  createStream: () => SherpaOfflineStream;
  decode: (stream: SherpaOfflineStream) => void;
  getResult: (stream: SherpaOfflineStream) => SherpaOfflineRecognizerResult;
  destroy?: () => void;
}

export interface SherpaOfflineRecognizerConfig {
  readonly featConfig: {
    readonly sampleRate: number;
    readonly featureDim: number;
  };
  readonly modelConfig: {
    readonly transducer: {
      readonly encoder: string;
      readonly decoder: string;
      readonly joiner: string;
    };
    readonly tokens: string;
    readonly modelType: string;
    readonly numThreads: number;
    readonly debug: boolean;
  };
}

export interface SherpaOnnxModule {
  readonly OfflineRecognizer: new (
    config: SherpaOfflineRecognizerConfig
  ) => SherpaOfflineRecognizer;
}

export interface ParakeetEngineOptions {
  readonly modelsRoot: string;
  /** Catalog id; defaults to PARAKEET_DEFAULT_MODEL_ID. */
  readonly modelId?: string;
  /**
   * Resolves the catalog id at call time, so a settings change takes effect
   * without recreating the engine. Takes precedence over `modelId`.
   */
  readonly getModelId?: () => string;
  /** Defaults to 8. */
  readonly numThreads?: number;
  readonly onWarmup?: (state: "cold" | "warming" | "warm" | "failed") => void;
  /** Tuning knob for tests; production runs on LOAD_RETRY_MS. */
  readonly loadRetryMs?: number;
  /** Test seam for the native module; production uses the lazy require. */
  readonly deps?: {
    readonly loadModule?: () => SherpaOnnxModule;
  };
}

class ParakeetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParakeetError";
  }
}

const defaultLoadModule = (): SherpaOnnxModule => {
  const nodeRequire = createRequire(import.meta.url);
  return nodeRequire("sherpa-onnx-node") as SherpaOnnxModule;
};

const parakeetFailure = (message: string): VoiceError => {
  const error: {
    readonly code: VoiceErrorCode;
    readonly message: string;
    readonly recoverable: boolean;
  } = {
    code: "PARAKEET" as VoiceErrorCode,
    message,
    recoverable: true
  };
  return error;
};

const buildRecognizerConfig = (
  modelDir: string,
  numThreads: number
): SherpaOfflineRecognizerConfig => ({
  featConfig: { sampleRate: SAMPLE_RATE, featureDim: FEATURE_DIM },
  modelConfig: {
    transducer: {
      encoder: join(modelDir, "encoder.int8.onnx"),
      decoder: join(modelDir, "decoder.int8.onnx"),
      joiner: join(modelDir, "joiner.int8.onnx")
    },
    tokens: join(modelDir, "tokens.txt"),
    modelType: "nemo_transducer",
    numThreads,
    debug: false
  }
});

export const createParakeetEngine = (
  options: ParakeetEngineOptions
): TranscriptionEngine => {
  const loadRetryMs = options.loadRetryMs ?? LOAD_RETRY_MS;
  const resolveModelId = (): string =>
    options.getModelId?.() ?? options.modelId ?? PARAKEET_DEFAULT_MODEL_ID;
  let recognizer: SherpaOfflineRecognizer | null = null;
  let recognizerModelId: string | null = null;
  let sherpaCache: SherpaOnnxModule | null = null;
  let sherpaLoadFailedAt = 0;
  let recognizerFailedAt = 0;

  const loadSherpa = (): SherpaOnnxModule => {
    if (sherpaCache !== null) {
      return sherpaCache;
    }
    if (sherpaLoadFailedAt !== 0 && Date.now() - sherpaLoadFailedAt < loadRetryMs) {
      throw new ParakeetError(NOT_INSTALLED_MESSAGE);
    }
    try {
      const loader = options.deps?.loadModule ?? defaultLoadModule;
      sherpaCache = loader();
      sherpaLoadFailedAt = 0;
      return sherpaCache;
    } catch {
      sherpaLoadFailedAt = Date.now();
      throw new ParakeetError(NOT_INSTALLED_MESSAGE);
    }
  };

  const ensureRecognizer = (): SherpaOfflineRecognizer => {
    const modelId = resolveModelId();
    // The recognizer is bound to one model's files; switching the selected
    // model swaps it rather than transcribing with the stale weights.
    if (recognizer !== null && recognizerModelId === modelId) {
      return recognizer;
    }
    if (recognizer !== null) {
      recognizer.destroy?.();
      recognizer = null;
    }
    const sherpa = loadSherpa();
    const model = findModel(modelId);
    if (model === null) {
      throw new ParakeetError(`Parakeet model "${modelId}" is not in the catalog.`);
    }
    const modelDir = join(options.modelsRoot, modelId);
    const missing = model.files.some(
      (file) => !existsSync(join(modelDir, file.path))
    );
    if (missing) {
      throw new ParakeetError(NOT_DOWNLOADED_MESSAGE);
    }
    try {
      recognizer = new sherpa.OfflineRecognizer(
        buildRecognizerConfig(modelDir, options.numThreads ?? DEFAULT_NUM_THREADS)
      );
      recognizerFailedAt = 0;
      recognizerModelId = modelId;
    } catch {
      recognizerFailedAt = Date.now();
      throw new ParakeetError(
        `Parakeet could not load the model files (${modelId}). They may be locked by another program or the native runtime may be blocked.`
      );
    }
    return recognizer;
  };

  const computeReadiness = (): EngineReadiness => {
    try {
      loadSherpa();
    } catch {
      return {
        ready: false,
        reason: NOT_INSTALLED_MESSAGE,
        action: "install-runtime"
      };
    }
    const modelId = resolveModelId();
    const model = findModel(modelId);
    if (model === null) {
      return {
        ready: false,
        reason: `Parakeet model "${modelId}" is not in the catalog.`
      };
    }
    const modelDir = join(options.modelsRoot, modelId);
    const complete = model.files.every((file) =>
      existsSync(join(modelDir, file.path))
    );
    if (!complete) {
      return {
        ready: false,
        reason: NOT_DOWNLOADED_MESSAGE,
        action: "download-model"
      };
    }
    // File existence is not enough: a recognizer that failed to construct
    // (ONNX init failure, blocked DLL) is not ready either. After the retry
    // window it stops claiming failure and the next capture tries again.
    if (recognizer === null && recognizerFailedAt !== 0 && Date.now() - recognizerFailedAt < loadRetryMs) {
      return {
        ready: false,
        reason:
          "Parakeet could not load its model files. They may be locked by another program; try again in a minute."
      };
    }
    return { ready: true };
  };

  return {
    id: PARAKEET_ENGINE_ID,
    displayName: "Parakeet",
    kind: "local",
    readiness: (): Promise<EngineReadiness> =>
      Promise.resolve(computeReadiness()),
    warmup: (): Promise<void> => {
      if (recognizer !== null) {
        return Promise.resolve();
      }
      options.onWarmup?.("warming");
      try {
        ensureRecognizer();
      } catch {
        options.onWarmup?.("failed");
        return Promise.resolve();
      }
      options.onWarmup?.("warm");
      return Promise.resolve();
    },
    transcribe: (
      request: TranscribeRequest
    ): Promise<Result<TranscribeResult>> => {
      try {
        const activeRecognizer = ensureRecognizer();
        const stream = activeRecognizer.createStream();
        stream.acceptWaveform({
          // sherpa expects Float32 in [-1, 1]; our pipeline is Int16.
          samples: Float32Array.from(request.pcm, (value) => value / 32768),
          sampleRate: SAMPLE_RATE
        });
        const startedAt = Date.now();
        activeRecognizer.decode(stream);
        const result = activeRecognizer.getResult(stream);
        const inferenceMs = Date.now() - startedAt;
        return Promise.resolve(
          ok({
            text: (result.text ?? "").trim(),
            language: null,
            engineId: PARAKEET_ENGINE_ID,
            modelId: resolveModelId(),
            inferenceMs,
            realtimeFactor: inferenceMs / Math.max(request.durationMs, 1),
            costUsd: null
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(fail(parakeetFailure(message)));
      }
    },
    dispose: (): Promise<void> => {
      if (recognizer !== null) {
        recognizer.destroy?.();
        recognizer = null;
      }
      recognizerModelId = null;
      return Promise.resolve();
    }
  };
};
