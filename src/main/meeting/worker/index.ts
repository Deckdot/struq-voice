/**
 * The meeting transcription worker, spawned as a utilityProcess per meeting.
 * Its own OS process and event loop: recognizer.decode is a synchronous
 * blocking native call, and running it in main would stall the tray, IPC and
 * every window pump for most of a meeting.
 *
 * Per lane: Silero VAD cuts utterances, the ASR engine decodes them, and on
 * the system lane each utterance is embedded and assigned to an incremental
 * speaker cluster. Main is the only SQLite writer; this process posts
 * finished segments and gaps over parentPort.
 *
 * Dictation always wins: on a yield command the worker finishes the utterance
 * it is on and stops dequeuing until released.
 */

import { createRequire } from "node:module";
import { createParakeetEngine } from "../../engines/parakeet";
import type { TranscriptionEngine } from "../../engines/types";
import { createWhisperCppEngine } from "../../engines/whisper-cpp";
import { slicePcm, trimSilence } from "../../audio/wav";
import type {
  WorkerCommand,
  WorkerEvent,
  WorkerFailure
} from "./protocol";
import { createSpeakerClusterer, type SpeakerClusterer } from "./speaker-clusterer";
import { createVadLane, type VadLane } from "./vad-lane";
import { drainVadSegments } from "./vad-segments";
import { refineLongTurn } from "./refine-long-turn";
import { computeSpeakerEmbedding } from "./speaker-embedding";

const nodeRequire = createRequire(import.meta.url);

const SAMPLE_RATE = 16_000;
const WINDOW_SIZE = 512;
const MAX_BACKLOG_SAMPLES = 600 * SAMPLE_RATE; // ten minutes
const HEARTBEAT_INTERVAL_MS = 1000;

interface SpeechSegment {
  readonly start: number;
  readonly samples: Float32Array;
}

interface VadLike {
  readonly acceptWaveform: (window: Float32Array) => void;
  readonly isEmpty: () => boolean;
  readonly front: (enableExternalBuffer: boolean) => SpeechSegment;
  readonly pop: () => void;
  readonly flush: () => void;
}

interface EmbeddingStreamLike {
  readonly acceptWaveform: (obj: { samples: Float32Array; sampleRate: number }) => void;
  readonly inputFinished: () => void;
}

interface EmbeddingExtractorLike {
  readonly createStream: () => EmbeddingStreamLike;
  readonly compute: (
    stream: EmbeddingStreamLike,
    enableExternalBuffer: boolean
  ) => Float32Array;
}

interface DiarizationSegment {
  readonly start: number;
  readonly end: number;
  readonly speaker: number;
}

interface DiarizerLike {
  readonly process: (samples: Float32Array) => DiarizationSegment[];
}

export interface SherpaMeetingModule {
  readonly Vad: new (config: object, bufferSizeInSeconds: number) => VadLike;
  readonly SpeakerEmbeddingExtractor: new (config: object) => EmbeddingExtractorLike;
  readonly OfflineSpeakerDiarization: new (config: object) => DiarizerLike;
}

let sherpa: SherpaMeetingModule | null = null;
let engine: TranscriptionEngine | null = null;
const vads: Partial<Record<"system" | "microphone", VadLane>> = {};
const vadInstances: Partial<Record<"system" | "microphone", VadLike>> = {};
let extractor: EmbeddingExtractorLike | null = null;
let diarizer: DiarizerLike | null = null;
let clusterer: SpeakerClusterer | null = null;
let speechLanguage: string | null = null;
let diarizationRefineOverMs = 6000;

interface QueuedUtterance {
  readonly source: "system" | "microphone";
  readonly startSample: number;
  readonly samples: Float32Array;
}

const queue: QueuedUtterance[] = [];
let queuedSamples = 0;
let decoding = false;
let yielding = false;
let draining = false;
let failed = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const parentPort = process.parentPort;

const post = (event: WorkerEvent): void => {
  parentPort.postMessage(event);
};

const postFailureOnce = (code: WorkerFailure["code"], message: string): void => {
  if (failed) return;
  failed = true;
  post({ type: "failure", code, message });
};

const sampleCountToMs = (samples: number): number =>
  Math.round(samples / (SAMPLE_RATE / 1000));

const toInt16 = (samples: Float32Array): Int16Array => {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.round((samples[i] ?? 0) * 32767);
  }
  return out;
};

const embed = (samples: Float32Array): Float32Array => {
  const activeExtractor = extractor;
  if (activeExtractor === null) {
    throw new Error("Embedding extractor is not initialised.");
  }
  return computeSpeakerEmbedding(activeExtractor, samples, SAMPLE_RATE);
};

const buildVad = (config: object): VadLike => {
  if (sherpa === null) {
    throw new Error("sherpa-onnx-node is not loaded.");
  }
  return new sherpa.Vad(
    {
      sileroVad: config,
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: "cpu",
      debug: false
    },
    30
  );
};

const transcribeUtterance = async (utterance: QueuedUtterance): Promise<void> => {
  const activeEngine = engine;
  if (activeEngine === null) {
    postFailureOnce("engine-not-ready", "The ASR engine never initialised.");
    return;
  }

  const durationMs = sampleCountToMs(utterance.samples.length);
  const samples = utterance.samples;

  // Speaker attribution. The microphone lane is you by construction; only
  // the system lane needs clustering.
  let segmentsToTranscribe: { startSample: number; samples: Float32Array; key: string }[];

  if (utterance.source === "system") {
    if (clusterer !== null && diarizationRefineOverMs > 0) {
      if (durationMs > diarizationRefineOverMs && diarizer !== null) {
        segmentsToTranscribe = refineSystemLongTurn(utterance.startSample, samples);
      } else {
        const key = clusterer.assign(embed(samples));
        segmentsToTranscribe = [{ startSample: utterance.startSample, samples, key }];
      }
    } else {
      // No diarization: every remote line is Speaker 1.
      segmentsToTranscribe = [{ startSample: utterance.startSample, samples, key: "s1" }];
    }
  } else {
    segmentsToTranscribe = [{ startSample: utterance.startSample, samples, key: "me" }];
  }

  for (const segment of segmentsToTranscribe) {
    const trimmed = trimSilence(toInt16(segment.samples), SAMPLE_RATE);
    const audio = slicePcm(toInt16(segment.samples), trimmed.start, trimmed.end);
    if (audio.length < SAMPLE_RATE / 20) {
      // Too little speech survives the trim (a cough). Drop silently.
      continue;
    }
    const controller = new AbortController();
    const outcome = await activeEngine.transcribe({
      pcm: audio,
      durationMs: Math.max(1, sampleCountToMs(audio.length)),
      ...(speechLanguage !== null ? { language: speechLanguage } : {}),
      signal: controller.signal
    });
    if (!outcome.ok) {
      postFailureOnce("decode-failed", outcome.error.message);
      return;
    }
    const text = outcome.value.text.trim();
    if (text.length === 0) {
      continue;
    }
    const startMs = sampleCountToMs(segment.startSample);
    const endMs = sampleCountToMs(segment.startSample + segment.samples.length);
    post({
      type: "segment",
      source: utterance.source,
      startMs,
      endMs,
      speakerKey: segment.key,
      text
    });
  }
};

/**
 * A VAD utterance longer than the refinement threshold is likely two people
 * talking over each other with no pause. Refinement lives in the pure module
 * so its slice math and same-speaker merge are unit tested.
 */
const refineSystemLongTurn = (
  utteranceStartSample: number,
  samples: Float32Array
): { startSample: number; samples: Float32Array; key: string }[] =>
  refineLongTurn({
    utteranceStartSample,
    samples,
    sampleRate: SAMPLE_RATE,
    minSubSegmentSeconds: 0.4,
    diarizer,
    clusterer,
    embed
  });

const enqueue = (utterance: QueuedUtterance): void => {
  if (queuedSamples + utterance.samples.length > MAX_BACKLOG_SAMPLES) {
    // Running out is honest: mark the span so the transcript says so in
    // place instead of silently eating audio or RAM.
    post({
      type: "gap",
      source: utterance.source,
      startMs: sampleCountToMs(utterance.startSample),
      endMs: sampleCountToMs(utterance.startSample + utterance.samples.length)
    });
    return;
  }
  queue.push(utterance);
  queuedSamples += utterance.samples.length;
  void pump();
};

const pump = async (): Promise<void> => {
  if (decoding) return;
  if (yielding && !draining) return;
  const next = queue.shift();
  if (next === undefined) {
    if (draining) post({ type: "drained" });
    return;
  }
  decoding = true;
  queuedSamples -= next.samples.length;
  try {
    await transcribeUtterance(next);
  } catch (error) {
    // A failed utterance is one lost line, never a failed meeting.
    const message = error instanceof Error ? error.message : String(error);
    postFailureOnce("decode-failed", message);
  } finally {
    decoding = false;
    // setImmediate, not recursion: the event loop must get a turn between
    // decodes or the parentPort messages carrying new audio never arrive.
    setImmediate(() => {
      void pump();
    });
  }
};

const onFrames = (frames: Extract<WorkerCommand, { type: "frames" }>): void => {
  const lane = vads[frames.source];
  if (lane === undefined) return;
  const samples = new Int16Array(frames.pcm);
  // Frames arrive in fixed 1s batches; the startSample of the batch is
  // carried, so absolute indices accumulate across lanes and pauses.
  let offset = 0;
  while (offset < samples.length) {
    const chunk = samples.subarray(offset, offset + WINDOW_SIZE * 10);
    lane.pushInt16(chunk);
    offset += WINDOW_SIZE * 10;
  }
};

const onInit = (init: Extract<WorkerCommand, { type: "init" }>): void => {
  try {
    sherpa = nodeRequire("sherpa-onnx-node") as SherpaMeetingModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postFailureOnce("assets-missing", message);
    return;
  }

  engine =
    init.engineId === "parakeet"
      ? createParakeetEngine({
          modelsRoot: init.modelsRoot,
          modelId: init.modelId,
          numThreads: init.numThreads
        })
      : createWhisperCppEngine({
          runtimeRoot: init.runtimeRoot,
          modelsRoot: init.modelsRoot,
          modelId: init.modelId
        });

  void (async () => {
    const readiness = await engine.readiness();
    if (!readiness.ready) {
      postFailureOnce(
        "engine-not-ready",
        readiness.reason ?? "The ASR engine is not ready."
      );
      return;
    }
    await engine.warmup();

    const vadConfig = {
      model: init.assetPaths.vad,
      threshold: 0.5,
      minSilenceDuration: init.vadMinSilenceMs / 1000,
      minSpeechDuration: init.vadMinSpeechMs / 1000,
      maxSpeechDuration: init.vadMaxSpeechMs / 1000,
      windowSize: WINDOW_SIZE
    };

    const makeLane = (source: "system" | "microphone"): VadLane =>
      createVadLane({
        windowSize: WINDOW_SIZE,
        acceptWindow: (window: Float32Array) => {
          vadInstances[source]?.acceptWaveform(window);
        },
        drainSegments: () => {
          const vad = vadInstances[source];
          return vad === undefined ? [] : drainVadSegments(vad);
        },
        onUtterance: (utterance) => {
          enqueue({ source, startSample: utterance.startSample, samples: utterance.samples });
        }
      });

    vadInstances.system = buildVad(vadConfig);
    vads.system = makeLane("system");
    vadInstances.microphone = buildVad(vadConfig);
    vads.microphone = makeLane("microphone");

    extractor = new sherpa.SpeakerEmbeddingExtractor({
      model: init.assetPaths.embedding,
      numThreads: 1,
      debug: false,
      provider: "cpu"
    });

    if (
      init.assetPaths.segmentation !== null &&
      init.diarizationRefineOverMs > 0
    ) {
      diarizer = new sherpa.OfflineSpeakerDiarization({
        segmentation: {
          pyannote: { model: init.assetPaths.segmentation },
          numThreads: 1,
          debug: false,
          provider: "cpu"
        },
        embedding: {
          model: init.assetPaths.embedding,
          numThreads: 1,
          debug: false,
          provider: "cpu"
        },
        // -1 lets the threshold decide how many voices are in this utterance,
        // which is the only sensible setting when the input is one turn of
        // unknown shape.
        clustering: { numClusters: -1, threshold: 0.55 },
        minDurationOn: 0.3,
        minDurationOff: 0.5
      });
    }

    clusterer = createSpeakerClusterer({
      threshold: init.speakerThreshold,
      maxSpeakers: init.maxSpeakers
    });
    speechLanguage = init.speechLanguage;
    diarizationRefineOverMs = init.diarizationRefineOverMs;

    heartbeatTimer = setInterval(() => {
      post({
        type: "heartbeat",
        queuedSeconds: Math.round(queuedSamples / SAMPLE_RATE),
        speakerCount: clusterer?.count() ?? 0
      });
    }, HEARTBEAT_INTERVAL_MS);

    post({ type: "ready" });
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    postFailureOnce("assets-missing", message);
  });
};

const onDrain = (): void => {
  draining = true;
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  // Flush the sherpa detectors first so their trailing speech surfaces, then
  // flush the lane carries and drain whatever came out.
  for (const vad of Object.values(vadInstances)) {
    vad.flush();
  }
  for (const lane of [vads.system, vads.microphone]) {
    lane?.flush();
  }
  void pump();
};

parentPort.on("message", (event) => {
  const command = event.data as WorkerCommand;
  switch (command.type) {
    case "init":
      onInit(command);
      break;
    case "frames":
      onFrames(command);
      break;
    case "yield":
      yielding = command.yielding;
      if (!yielding) {
        void pump();
      }
      break;
    case "drain":
      onDrain();
      break;
  }
});
