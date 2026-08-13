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
  /**
   * Non-blocking decode: runs on the addon's worker thread and resolves with
   * the final result. Absent on older runtimes and test fakes; callers fall
   * back to decode + getResult.
   */
  decodeAsync?: (stream: SherpaOfflineStream) => Promise<SherpaOfflineRecognizerResult>;
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

export interface SherpaOfflineRecognizerConstructor {
  new (config: SherpaOfflineRecognizerConfig): SherpaOfflineRecognizer;
  /**
   * Non-blocking construction: the ONNX model load (1-3s) runs on the
   * addon's worker thread instead of the event loop. Absent on older
   * runtimes and test fakes; callers fall back to the constructor.
   */
  createAsync?: (
    config: SherpaOfflineRecognizerConfig
  ) => Promise<SherpaOfflineRecognizer>;
}

export interface SherpaOnnxModule {
  readonly OfflineRecognizer: SherpaOfflineRecognizerConstructor;
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
  let recognizerPromise: Promise<SherpaOfflineRecognizer> | null = null;
  let recognizerModelId: string | null = null;
  let sherpaCache: SherpaOnnxModule | null = null;
  let sherpaLoadFailedAt = 0;
  let recognizerFailedAt = 0;
  // Serializes every native call on the recognizer. sherpa-onnx does not
  // allow concurrent decode() calls on one recognizer, and with the async
  // decode the event loop keeps running while a decode is in flight, so a
  // live-transcript pass and the final pass could otherwise overlap. One
  // decode at a time, in arrival order.
  let decodeQueue: Promise<void> = Promise.resolve();

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

  const buildRecognizer = async (modelId: string): Promise<SherpaOfflineRecognizer> => {
    // The recognizer is bound to one model's files; switching the selected
    // model swaps it rather than transcribing with the stale weights.
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
    const config = buildRecognizerConfig(modelDir, options.numThreads ?? DEFAULT_NUM_THREADS);
    try {
      if (sherpa.OfflineRecognizer.createAsync !== undefined) {
        try {
          const built = await sherpa.OfflineRecognizer.createAsync(config);
          recognizerFailedAt = 0;
          return built;
        } catch {
          // Async construction can be rejected for a given model; the
          // synchronous constructor is the established fallback.
        }
      }
      const built = new sherpa.OfflineRecognizer(config);
      recognizerFailedAt = 0;
      return built;
    } catch {
      recognizerFailedAt = Date.now();
      throw new ParakeetError(
        `Parakeet could not load the model files (${modelId}). They may be locked by another program or the native runtime may be blocked.`
      );
    }
  };

  const ensureRecognizerAsync = (): Promise<SherpaOfflineRecognizer> => {
    const modelId = resolveModelId();
    if (recognizer !== null && recognizerModelId === modelId) {
      return Promise.resolve(recognizer);
    }
    // A construction already in flight (warmup, another capture): share it
    // rather than loading the model twice.
    if (recognizerPromise !== null) {
      return recognizerPromise;
    }
    const pending = buildRecognizer(modelId).then((built) => {
      // Release the shared slot before any further decision: a model switch
      // below must be able to start a fresh build rather than resolving this
      // promise with itself, and no later clearing may clobber that new
      // build's slot.
      recognizerPromise = null;
      if (resolveModelId() === modelId) {
        recognizer = built;
        recognizerModelId = modelId;
        return built;
      }
      // The selection changed while the model loaded: this instance is
      // already stale. Discard it and rebuild for the current selection.
      built.destroy?.();
      return ensureRecognizerAsync();
    });
    recognizerPromise = pending;
    // A failed build must also release the shared slot, or every later
    // transcription would await a permanently rejected promise. The success
    // path releases inside the callback above.
    void pending.then(
      () => undefined,
      () => {
        recognizerPromise = null;
      }
    );
    return pending;
  };

  const decodeStream = async (
    activeRecognizer: SherpaOfflineRecognizer,
    stream: SherpaOfflineStream
  ): Promise<SherpaOfflineRecognizerResult> => {
    if (activeRecognizer.decodeAsync === undefined) {
      activeRecognizer.decode(stream);
      return activeRecognizer.getResult(stream);
    }
    try {
      // The non-blocking path: the native decode runs on the addon's worker
      // thread while the app keeps painting and answering IPC.
      return await activeRecognizer.decodeAsync(stream);
    } catch {
      // Some runtimes reject the async path for a given model. The stream is
      // still virgin at that point, so the synchronous path is a safe retry.
      activeRecognizer.decode(stream);
      return activeRecognizer.getResult(stream);
    }
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
      // Construction goes through the async factory when the runtime has
      // one, so the 1-3s model load happens off the event loop: the warmup
      // that used to hang app startup now runs in the background.
      return ensureRecognizerAsync().then(
        () => {
          options.onWarmup?.("warm");
        },
        () => {
          options.onWarmup?.("failed");
        }
      );
    },
    transcribe: (
      request: TranscribeRequest
    ): Promise<Result<TranscribeResult>> => {
      const job = decodeQueue.then(async () => {
        // An aborted request waiting behind an earlier decode is dead weight:
        // skip the native work entirely. (The live transcript aborts its pass
        // the moment the capture ends, so the final pass never queues behind
        // a fresh partial decode.)
        if (request.signal.aborted) {
          return fail(parakeetFailure("Transcription was cancelled."));
        }
        const activeRecognizer = await ensureRecognizerAsync();
        const stream = activeRecognizer.createStream();
        stream.acceptWaveform({
          // sherpa expects Float32 in [-1, 1]; our pipeline is Int16.
          samples: Float32Array.from(request.pcm, (value) => value / 32768),
          sampleRate: SAMPLE_RATE
        });
        const startedAt = Date.now();
        const result = await decodeStream(activeRecognizer, stream);
        const inferenceMs = Date.now() - startedAt;
        return ok({
          text: (result.text ?? "").trim(),
          language: null,
          engineId: PARAKEET_ENGINE_ID,
          modelId: resolveModelId(),
          inferenceMs,
          realtimeFactor: inferenceMs / Math.max(request.durationMs, 1),
          costUsd: null
        });
      });
      // Keep the queue alive regardless of outcome; every error is already
      // folded into the Result, so this branch only exists to unblock the
      // next decode.
      decodeQueue = job.then(
        () => undefined,
        () => undefined
      );
      return job.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return fail(parakeetFailure(message));
      });
    },
    dispose: (): Promise<void> => {
      // Never destroy a recognizer that a decode or construction is still
      // using: that is a use-after-free inside the native worker. Drain the
      // queue (and a construction in flight) first, then release.
      return Promise.allSettled([
        recognizerPromise ?? Promise.resolve(),
        decodeQueue
      ]).then(() => {
        if (recognizer !== null) {
          recognizer.destroy?.();
          recognizer = null;
        }
        recognizerModelId = null;
      });
    }
  };
};
