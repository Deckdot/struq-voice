/**
 * The meeting window's audio pipeline. Owned entirely by this window, which
 * exists only while a meeting runs: the Windows loopback stream (everyone
 * else) and optionally the microphone (you), transcribed as separate lanes
 * and mixed only into the opus archive.
 *
 * The pipeline is driven from main through executeJavaScript because
 * getDisplayMedia needs transient user activation and a hotkey-started
 * meeting has none. The begin request arrives over IPC first and is stored;
 * main then calls window.__struqBeginMeetingAudio() to acquire.
 */

import type { MeetingWindowApi } from "../../shared/api";
import type {
  MeetingAudioBeginRequest,
  MeetingAudioFrames,
  MeetingLevelsEvent
} from "../../shared/ipc";
import workletUrl from "./meeting-collector.worklet.js?url";

const TARGET_SAMPLE_RATE = 16_000;
const LEVELS_INTERVAL_MS = 100; // 10 Hz, the only timer in this window
const REACQUIRE_GRACE_MS = 1500;
const STOP_TIMEOUT_MS = 5000;

type Lane = "system" | "microphone";

interface LanePipeline {
  readonly source: MediaStreamAudioSourceNode;
  readonly worklet: AudioWorkletNode;
}

let beginRequest: MeetingAudioBeginRequest | null = null;
const lanes = new Map<Lane, LanePipeline>();
let context: AudioContext | null = null;
let archiveRecorder: MediaRecorder | null = null;
const lastPeak: { system: number; microphone: number } = { system: 0, microphone: 0 };
let levelsTimer: ReturnType<typeof setInterval> | null = null;
let stopping = false;
let stopResolve: (() => void) | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let api: MeetingWindowApi | null = null;
let paused = false;

declare global {
  interface Window {
    __struqBeginMeetingAudio: () => void;
  }
}

export const initMeetingAudio = (windowApi: MeetingWindowApi): void => {
  api = windowApi;
  windowApi.onBegin((request) => {
    beginRequest = request;
    window.__struqBeginMeetingAudio = () => {
      void begin();
    };
  });
  windowApi.onStop(() => {
    stopAll();
  });
  windowApi.onPause((value) => {
    setPaused(value);
  });
};

const setPaused = (value: boolean): void => {
  paused = value;
  if (paused) {
    // Stop the archive without tearing anything down. The lanes, worklets and
    // level meters keep running: main gates the transcript, and the archive
    // recorder simply stops collecting until resumed.
    if (archiveRecorder !== null && archiveRecorder.state === "recording") {
      archiveRecorder.pause();
    }
  } else if (archiveRecorder !== null && archiveRecorder.state === "paused") {
    archiveRecorder.resume();
  }
};

const laneHealth = (lane: Lane): { live: boolean; code?: string } =>
  lanes.has(lane)
    ? { live: true }
    : { live: false, code: lane === "system" ? "loopback-unavailable" : "microphone-unavailable" };

const reportState = (): void => {
  if (api === null) return;
  api.sendState({
    system: laneHealth("system"),
    microphone: laneHealth("microphone"),
    finished: stopping
  });
};

const reportLaneFailure = (lane: Lane, code: string): void => {
  if (api === null) return;
  api.sendState({
    system: lane === "system" ? { live: false, code } : laneHealth("system"),
    microphone:
      lane === "microphone" ? { live: false, code } : laneHealth("microphone"),
    finished: false
  });
};

const acquireSystem = async (): Promise<MediaStream | null> => {
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      // Chromium refuses an audio-only display capture, so a video track is
      // requested at the smallest size it will accept and stopped immediately.
      // Nothing reads it.
      video: { width: { max: 2 }, height: { max: 2 }, frameRate: { max: 1 } }
    });
    for (const track of display.getVideoTracks()) {
      track.stop();
      display.removeTrack(track);
    }
    return display;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      reportLaneFailure("system", "loopback-denied");
    } else {
      reportLaneFailure("system", "loopback-unavailable");
    }
    return null;
  }
};

const acquireMicrophone = async (): Promise<MediaStream | null> => {
  const request = beginRequest;
  if (request === null || !request.includeMicrophone) return null;
  const constraints: MediaStreamConstraints = {
    audio: {
      channelCount: 1,
      // Raw voice, not conferenced voice: the models denoise better than
      // browser DSP. Auto gain genuinely helps.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      ...(request.microphoneDeviceId !== null
        ? { deviceId: request.microphoneDeviceId }
        : {})
    }
  };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    reportLaneFailure("microphone", "microphone-unavailable");
    return null;
  }
};

const attachLane = (lane: Lane, stream: MediaStream): void => {
  if (context === null) return;
  const source = context.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(context, "meeting-collector");

  worklet.port.onmessage = (event: MessageEvent) => {
    const message = event.data as {
      type?: string;
      pcm?: ArrayBuffer;
      startSample?: number;
      peak?: number;
    };
    if (message.type === "batch" && message.pcm !== undefined) {
      lastPeak[lane] = message.peak ?? 0;
      if (paused) return;
      const frames: MeetingAudioFrames = {
        source: lane,
        pcm: message.pcm,
        startSample: message.startSample ?? 0,
        sampleRate: TARGET_SAMPLE_RATE
      };
      api?.sendFrames(frames);
      return;
    }
    if (message.type === "flushed") {
      lanes.delete(lane);
      // Release the dead node pair: the track has ended, so keeping the
      // source+worklet connected only accumulates garbage on reacquire.
      source.disconnect();
      worklet.disconnect();
      worklet.port.close();
      reportState();
      maybeFinishStop();
    }
  };

  source.connect(worklet);
  lanes.set(lane, { source, worklet });
  reportState();
};

const begin = async (): Promise<void> => {
  const request = beginRequest;
  if (request === null || context !== null) return;

  const system = await acquireSystem();
  if (system === null) return;

  const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    await audioContext.audioWorklet.addModule(workletUrl);
  } catch (error) {
    // The system stream is live and the context is half-built: release both
    // instead of orphaning them until GC.
    system.getTracks().forEach((track) => {
      track.stop();
    });
    void audioContext.close();
    throw error;
  }
  context = audioContext;

  const archiveSink = audioContext.createMediaStreamDestination();
  const systemSource = audioContext.createMediaStreamSource(system);
  const systemWorklet = new AudioWorkletNode(audioContext, "meeting-collector");
  systemSource.connect(systemWorklet);
  systemSource.connect(archiveSink);
  lanes.set("system", { source: systemSource, worklet: systemWorklet });
  reportState();

  system.getTracks()[0]?.addEventListener("ended", () => {
    handleTrackEnded("system");
  });

  const mic = await acquireMicrophone();
  if (mic !== null) {
    attachLane("microphone", mic);
    mic.getTracks()[0]?.addEventListener("ended", () => {
      handleTrackEnded("microphone");
    });
  }

  if (request.archiveAudio) {
    startArchive(archiveSink, request);
  }

  levelsTimer = setInterval(() => {
    const levels: MeetingLevelsEvent = {
      system: lastPeak.system,
      microphone: lastPeak.microphone
    };
    api?.sendLevels(levels);
  }, LEVELS_INTERVAL_MS);
};

const startArchive = (
  sink: MediaStreamAudioDestinationNode,
  request: MeetingAudioBeginRequest
): void => {
  if (typeof MediaRecorder === "undefined") return;
  let mimeType = "audio/webm;codecs=opus";
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    if (MediaRecorder.isTypeSupported("audio/webm")) {
      mimeType = "audio/webm";
    } else {
      // A transcript with no recording is far better than no meeting.
      return;
    }
  }
  const recorder = new MediaRecorder(sink.stream, {
    mimeType,
    audioBitsPerSecond: request.archiveBitrateKbps * 1000
  });
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size === 0) return;
    void event.data.arrayBuffer().then((bytes) => {
      api?.sendArchiveChunk({ bytes });
    });
  };
  // Chunks every five seconds: a crash loses at most five seconds and the
  // webm stays playable.
  recorder.start(5000);
  archiveRecorder = recorder;
};

const handleTrackEnded = (lane: Lane): void => {
  if (stopping) return;
  // The loopback track ends when the default render endpoint changes (a
  // headphone plug-in). Report it and reacquire once after a short grace.
  if (lane === "system") {
    api?.sendState({
      system: { live: false, code: "device-changed" },
      microphone: laneHealth("microphone"),
      finished: false
    });
  }
  const pipeline = lanes.get(lane);
  if (pipeline !== undefined) {
    pipeline.worklet.port.postMessage({ type: "flush" });
  }
  setTimeout(() => {
    void reacquireLane(lane);
  }, REACQUIRE_GRACE_MS);
};

const reacquireLane = async (lane: Lane): Promise<void> => {
  if (stopping || api === null || context === null) return;
  if (lane === "system") {
    const stream = await acquireSystem();
    if (stream !== null) {
      attachLane("system", stream);
      stream.getTracks()[0]?.addEventListener("ended", () => {
        handleTrackEnded("system");
      });
    }
  } else {
    const stream = await acquireMicrophone();
    if (stream !== null) {
      attachLane("microphone", stream);
      stream.getTracks()[0]?.addEventListener("ended", () => {
        handleTrackEnded("microphone");
      });
    }
  }
};

const maybeFinishStop = (): void => {
  if (!stopping) return;
  const recorderDone = archiveRecorder === null || archiveRecorder.state === "inactive";
  if (lanes.size === 0 && recorderDone) {
    if (stopTimer !== null) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    const resolve = stopResolve;
    stopResolve = null;
    resolve?.();
  }
};

const stopAll = (): void => {
  if (stopping) return;
  stopping = true;
  reportState();

  for (const pipeline of lanes.values()) {
    pipeline.worklet.port.postMessage({ type: "flush" });
  }

  const recorder = archiveRecorder;
  if (recorder !== null && recorder.state !== "inactive") {
    // Wait for the final dataavailable pass to land before the context is
    // closed, so the archive tail is not lost.
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size === 0) return;
      void event.data.arrayBuffer().then((bytes) => {
        api?.sendArchiveChunk({ bytes });
        maybeFinishStop();
      });
    };
    recorder.stop();
  } else {
    maybeFinishStop();
  }

  void new Promise<void>((resolve) => {
    stopResolve = resolve;
    // Losing the tail of a meeting because the window was torn down early is
    // the failure mode this timeout exists for; main also times out at 5s.
    stopTimer = setTimeout(() => {
      stopResolve = null;
      resolve();
    }, STOP_TIMEOUT_MS);
  }).then(() => {
    if (levelsTimer !== null) {
      clearInterval(levelsTimer);
      levelsTimer = null;
    }
    for (const pipeline of lanes.values()) {
      pipeline.source.mediaStream.getTracks().forEach((track) => {
        track.stop();
      });
    }
    lanes.clear();
    const current = context;
    context = null;
    if (current !== null) {
      void current.close();
    }
    api?.sendState({
      system: { live: false },
      microphone: { live: false },
      finished: true
    });
  });
};
