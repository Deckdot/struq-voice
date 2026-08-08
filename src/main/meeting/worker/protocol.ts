/**
 * The wire format between main and the meeting worker utilityProcess.
 * Structured clone only: no functions, no class instances. ArrayBuffers are
 * copied rather than transferred, because UtilityProcess.postMessage takes a
 * transfer list of MessagePortMain only. At one second of 16 kHz mono Int16
 * that is a 32 KB copy per lane per second, which is not worth engineering
 * around.
 */

export interface WorkerInit {
  readonly type: "init";
  readonly engineId: "parakeet" | "whisper-cpp";
  readonly modelsRoot: string;
  readonly runtimeRoot: string;
  readonly modelId: string;
  readonly assetPaths: {
    readonly vad: string;
    readonly embedding: string;
    /** Null when refinement is off or the asset is not installed. */
    readonly segmentation: string | null;
  };
  readonly numThreads: number;
  readonly diarization: boolean;
  readonly diarizationRefineOverMs: number;
  readonly speakerThreshold: number;
  readonly maxSpeakers: number;
  readonly vadMinSpeechMs: number;
  readonly vadMinSilenceMs: number;
  readonly vadMaxSpeechMs: number;
  readonly speechLanguage: string | null;
}

export interface WorkerFrames {
  readonly type: "frames";
  readonly source: "system" | "microphone";
  readonly pcm: ArrayBuffer;
  readonly startSample: number;
}

/** Dictation is active. Finish the current utterance, then hold. */
export interface WorkerYield {
  readonly type: "yield";
  readonly yielding: boolean;
}

/** No more audio is coming. Drain the queue, then exit. */
export interface WorkerDrain {
  readonly type: "drain";
}

export type WorkerCommand = WorkerInit | WorkerFrames | WorkerYield | WorkerDrain;

export interface WorkerReady {
  readonly type: "ready";
}

export interface WorkerSegment {
  readonly type: "segment";
  readonly source: "system" | "microphone";
  readonly startMs: number;
  readonly endMs: number;
  readonly speakerKey: string;
  readonly text: string;
}

export interface WorkerGap {
  readonly type: "gap";
  readonly source: "system" | "microphone";
  readonly startMs: number;
  readonly endMs: number;
}

/** Sent at most once a second, so main can drive the backlog indicator. */
export interface WorkerHeartbeat {
  readonly type: "heartbeat";
  readonly queuedSeconds: number;
  readonly speakerCount: number;
}

export interface WorkerFailure {
  readonly type: "failure";
  readonly code: "engine-not-ready" | "assets-missing" | "decode-failed";
  readonly message: string;
}

export interface WorkerDrained {
  readonly type: "drained";
}

export type WorkerEvent =
  | WorkerReady
  | WorkerSegment
  | WorkerGap
  | WorkerHeartbeat
  | WorkerFailure
  | WorkerDrained;
