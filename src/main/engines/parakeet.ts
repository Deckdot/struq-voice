/**
 * The local Parakeet STT engine via sherpa-onnx-node. The native addon is
 * required lazily so this module loads even when the addon is missing;
 * readiness and transcribe then report the install step instead of crashing.
 * The engine takes injected options only and never reads the settings store.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { findModel } from "../../shared/models";
import type { Result, VoiceError, VoiceErrorCode } from "../../shared/result";
import { fail, ok } from "../../shared/result";
import type {
  EngineReadiness,
  TranscribeRequest,
  TranscribeResult,
  TranscriptionEngine
} from "./types";

export const PARAKEET_ENGINE_ID = "parakeet" as const;
export const PARAKEET_DEFAULT_MODEL_ID = "parakeet-tdt-0.6b-v3-int8";

const DEFAULT_NUM_THREADS = 8;
const SAMPLE_RATE = 16_000;
const FEATURE_DIM = 80;

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
  /** Defaults to 8. */
  readonly numThreads?: number;
  readonly onWarmup?: (state: "cold" | "warming" | "warm" | "failed") => void;
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
  let recognizer: SherpaOfflineRecognizer | null = null;
  let sherpaCache: SherpaOnnxModule | null = null;
  let sherpaLoadFailed = false;

  const loadSherpa = (): SherpaOnnxModule => {
    if (sherpaCache !== null) {
      return sherpaCache;
    }
    if (sherpaLoadFailed) {
      throw new ParakeetError(NOT_INSTALLED_MESSAGE);
    }
    try {
      const loader = options.deps?.loadModule ?? defaultLoadModule;
      sherpaCache = loader();
      return sherpaCache;
    } catch {
      sherpaLoadFailed = true;
      throw new ParakeetError(NOT_INSTALLED_MESSAGE);
    }
  };

  const ensureRecognizer = (): SherpaOfflineRecognizer => {
    if (recognizer !== null) {
      return recognizer;
    }
    const sherpa = loadSherpa();
    const modelId = options.modelId ?? PARAKEET_DEFAULT_MODEL_ID;
    const model = findModel(modelId);
    if (model === null) {
      throw new ParakeetError(
        `Parakeet model "${modelId}" is not in the catalog.`
      );
    }
    const modelDir = join(options.modelsRoot, modelId);
    const missing = model.files.some(
      (file) => !existsSync(join(modelDir, file.path))
    );
    if (missing) {
      throw new ParakeetError(NOT_DOWNLOADED_MESSAGE);
    }
    recognizer = new sherpa.OfflineRecognizer(
      buildRecognizerConfig(modelDir, options.numThreads ?? DEFAULT_NUM_THREADS)
    );
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
    const modelId = options.modelId ?? PARAKEET_DEFAULT_MODEL_ID;
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
            modelId: options.modelId ?? PARAKEET_DEFAULT_MODEL_ID,
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
      return Promise.resolve();
    }
  };
};
