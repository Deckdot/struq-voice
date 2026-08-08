/**
 * The recorder window's audio pipeline. Owned entirely by this window:
 * a permanently warm getUserMedia stream feeding the pcm-collector worklet,
 * a 30s ring buffer for pre-roll, 60Hz analyser levels to the overlay, and
 * a stream watchdog that re-acquires a dead microphone.
 *
 * AudioWorklet, not ScriptProcessorNode (deprecated, main-thread glitches)
 * and not MediaRecorder (Opus/WebM that would need decoding).
 */

import type { RecorderDevice, RecorderWindowApi } from "../../shared/api";
import { playCaptureSound } from "./sounds";
import workletUrl from "./pcm-collector.worklet.js?url";

const TARGET_SAMPLE_RATE = 16_000;
const DEFAULT_PREROLL_MS = 250;
const BAND_COUNT = 32;
const LEVELS_INTERVAL_MS = 16; // ~60Hz
const REACQUIRE_GRACE_MS = 2000;

interface AudioPipeline {
  readonly api: RecorderWindowApi;
  readonly stream: MediaStream;
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;
  readonly worklet: AudioWorkletNode;
  readonly unsubscribeBegin: () => void;
  readonly unsubscribeEnd: () => void;
  readonly unsubscribeDiscard: () => void;
  readonly unsubscribeLevelsEnabled: () => void;
  readonly unsubscribeSnapshot: () => void;
}

let current: AudioPipeline | null = null;
let levelsTimer: ReturnType<typeof setInterval> | null = null;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
// Whether main currently wants levels. Survives a pipeline rebuild: a device
// switch mid-capture must not leave the overlay waveform frozen.
let levelsWanted = false;
// Invalidates in-flight pipeline builds: a device switch, teardown or a newer
// build makes an older build clean up its own half-built pipeline instead of
// overwriting `current` and orphaning a warm stream + AudioContext.
let pipelineToken = 0;
const retryTimers = new Set<ReturnType<typeof setTimeout>>();
let deviceChangeListenerAttached = false;
let deviceListListenerAttached = false;

/**
 * Answer device-list requests. Enumeration opens no stream and needs no
 * permission, so this is safe to attach even when the microphone itself is
 * skipped. Attached once per session, not per pipeline build.
 */
export const initRecorderDeviceList = (api: RecorderWindowApi): void => {
  if (deviceListListenerAttached) return;
  deviceListListenerAttached = true;
  api.onGetDevices(() => {
    void listAudioDevices().then((devices) => {
      // The selected id lives in this window's localStorage, so it travels
      // with the list; main has no way to read it otherwise.
      api.sendDevices(devices, currentDeviceId());
    });
  });
  api.onSetDevice((deviceId) => {
    switchDevice(api, deviceId);
  });
};

export const initRecorderAudio = (api: RecorderWindowApi): void => {
  initRecorderDeviceList(api);
  initCaptureSounds(api);
  void buildPipeline(api);
};

/**
 * Attached once per session rather than per pipeline: the pipeline is torn
 * down and rebuilt on every device change, and a sound listener that came and
 * went with it would miss the capture that follows a microphone switch.
 */
let soundListenerAttached = false;

export const initCaptureSounds = (api: RecorderWindowApi): void => {
  if (soundListenerAttached) return;
  soundListenerAttached = true;
  api.onPlaySound(({ bytes, volume }) => {
    void playCaptureSound(bytes, volume);
  });
};

const currentDeviceId = (): string | null =>
  localStorage.getItem("struq.audio.deviceId");

const persistDeviceId = (deviceId: string): void => {
  localStorage.setItem("struq.audio.deviceId", deviceId);
};

/** Enumerate audio input devices, labels included once a stream exists. */
export const listAudioDevices = async (): Promise<RecorderDevice[]> => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label.length > 0 ? device.label : device.deviceId
    }));
};

/** Switch to another microphone and re-acquire the warm stream. */
const switchDevice = (api: RecorderWindowApi, deviceId: string): void => {
  if (currentDeviceId() === deviceId && current !== null) return;
  persistDeviceId(deviceId);
  api.sendStreamState({ live: false, reason: "Microphone device changed" });
  teardown();
  void buildPipeline(api);
};

const teardown = (): void => {
  pipelineToken++;
  for (const timer of retryTimers) {
    clearTimeout(timer);
  }
  retryTimers.clear();
  stopLevelsLoop();
  if (monitorTimer !== null) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  if (current !== null) {
    current.unsubscribeBegin();
    current.unsubscribeEnd();
    current.unsubscribeDiscard();
    current.unsubscribeLevelsEnabled();
    current.unsubscribeSnapshot();
    current.stream.getTracks().forEach((track) => {
      track.stop();
    });
    void current.context.close();
    current = null;
  }
};

/**
 * Schedule a delayed pipeline re-acquire. Tracked so teardown can cancel
 * pending retries: an untracked retry can fire after a device switch and
 * build a second warm pipeline that orphans the first.
 */
const scheduleRetry = (callback: () => void): void => {
  const timer = setTimeout(() => {
    retryTimers.delete(timer);
    callback();
  }, REACQUIRE_GRACE_MS);
  retryTimers.add(timer);
};

/**
 * Float samples in -1..1 to the Int16 PCM both engines expect. Returns the
 * backing ArrayBuffer too: it is allocated here, so it is never a
 * SharedArrayBuffer, and the transfer list needs the concrete type.
 */
const toInt16 = (samples: Float32Array): { pcm: ArrayBuffer } => {
  const buffer = new ArrayBuffer(samples.length * Int16Array.BYTES_PER_ELEMENT);
  const int16 = new Int16Array(buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    int16[i] = Math.round(clamped * 32767);
  }
  return { pcm: buffer };
};

const acquireStream = async (): Promise<MediaStream> => {
  const deviceId = localStorage.getItem("struq.audio.deviceId") ?? undefined;
  const constraints: MediaStreamConstraints = {
    audio: {
      channelCount: 1,
      // Raw voice, not conferenced voice: the models denoise better than
      // browser DSP. Auto gain genuinely helps.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      ...(deviceId !== undefined ? { deviceId } : {})
    }
  };
  return navigator.mediaDevices.getUserMedia(constraints);
};

const buildPipeline = async (api: RecorderWindowApi): Promise<void> => {
  const token = ++pipelineToken;
  let stream: MediaStream;
  try {
    stream = await acquireStream();
  } catch {
    api.sendStreamState({
      live: false,
      reason: "No microphone found. Plug one in and restart Struq Voice."
    });
    // Keep trying in the background; a hotplug should recover the app.
    scheduleRetry(() => {
      void buildPipeline(api);
    });
    return;
  }
  if (token !== pipelineToken) {
    // A newer build or a teardown took over while we waited for the mic.
    stream.getTracks().forEach((track) => {
      track.stop();
    });
    return;
  }

  // The browser resamples to 16kHz, which both engines want. Doing it by
  // hand would be slower and worse.
  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    await context.audioWorklet.addModule(workletUrl);
    if (token !== pipelineToken) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      void context.close();
      return;
    }

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 128; // 64 frequency bins, paired into 32 bands
    const worklet = new AudioWorkletNode(context, "pcm-collector");

    source.connect(analyser);
    analyser.connect(worklet);

    const unsubscribeBegin = api.onBeginCapture(({ maxCaptureMs }) => {
      worklet.port.postMessage({
        type: "arm",
        prerollSamples: Math.floor((TARGET_SAMPLE_RATE * DEFAULT_PREROLL_MS) / 1000),
        maxCaptureMs
      });
    });

    const unsubscribeEnd = api.onEndCapture(() => {
      worklet.port.postMessage({ type: "disarm" });
    });

    const unsubscribeDiscard = api.onDiscardCapture(() => {
      worklet.port.postMessage({ type: "discard" });
    });

    // Main decides when levels are worth computing: during a capture, and
    // while a window shows a microphone meter. Outside both the loop is pure
    // cost, so it stays stopped.
    const unsubscribeLevelsEnabled = api.onLevelsEnabled((enabled) => {
      levelsWanted = enabled;
      if (enabled) {
        startLevelsLoop();
      } else {
        stopLevelsLoop();
      }
    });

    const unsubscribeSnapshot = api.onSnapshotRequest((sequence) => {
      worklet.port.postMessage({ type: "snapshot", sequence });
    });

    worklet.port.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        samples?: Float32Array;
        sequence?: number;
      };
      if (message.samples === undefined) return;
      if (message.type !== "capture" && message.type !== "snapshot") return;

      const samples = message.samples;
      const { pcm } = toInt16(samples);
      const durationMs = Math.round((samples.length / TARGET_SAMPLE_RATE) * 1000);

      if (message.type === "snapshot") {
        api.sendSnapshotData({
          pcm,
          durationMs,
          sampleRate: TARGET_SAMPLE_RATE,
          sequence: message.sequence ?? 0
        });
        return;
      }

      api.sendCaptureData({
        pcm,
        durationMs,
        sampleRate: TARGET_SAMPLE_RATE
      });
    };

    current = {
      api,
      stream,
      context,
      analyser,
      worklet,
      unsubscribeBegin,
      unsubscribeEnd,
      unsubscribeDiscard,
      unsubscribeLevelsEnabled,
      unsubscribeSnapshot
    };

    // A rebuild (device switch, mute recovery) must not leave a meter or the
    // overlay waveform frozen: pick the loop back up if demand still stands.
    if (levelsWanted) startLevelsLoop();

    api.sendStreamState({ live: true });

    // The microphone's own lifecycle: track.onended fires on unplug or driver
    // reset. A dead mic must never silently produce empty transcripts.
    stream.getTracks()[0]?.addEventListener("ended", () => {
      api.sendStreamState({ live: false, reason: "Microphone disconnected" });
      teardown();
      scheduleRetry(() => {
        void buildPipeline(api);
      });
    });

    // Some drivers report mute before onended. Re-acquire if it does not
    // recover on its own.
    monitorTimer = setInterval(() => {
      const track = current?.stream.getTracks()[0];
      if (track !== undefined && track.muted) {
        scheduleRetry(() => {
          if (track.muted) {
            api.sendStreamState({ live: false, reason: "Microphone muted" });
            teardown();
            void buildPipeline(api);
          }
        });
      }
    }, 5000);

    if (!deviceChangeListenerAttached) {
      deviceChangeListenerAttached = true;
      // Windows rotates device IDs across reboots and hotplugs change the
      // default device. Re-enumerate and follow the default when it moves.
      navigator.mediaDevices.addEventListener("devicechange", () => {
        void handleDeviceChange(api);
      });
    }
  } catch (error) {
    // The mic stream is open at this point; never let a failed setup leave
    // it capturing into a half-built pipeline.
    stopLevelsLoop();
    if (monitorTimer !== null) {
      clearInterval(monitorTimer);
      monitorTimer = null;
    }
    stream.getTracks().forEach((track) => {
      track.stop();
    });
    void context.close();
    throw error;
  }
};

const stopLevelsLoop = (): void => {
  if (levelsTimer !== null) {
    clearInterval(levelsTimer);
    levelsTimer = null;
  }
};

const startLevelsLoop = (): void => {
  stopLevelsLoop();
  levelsTimer = setInterval(() => {
    const pipeline = current;
    if (pipeline === null) return;
    const { api, analyser } = pipeline;
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);
    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(timeData);

    const bands: number[] = [];
    const perBand = frequencyData.length / BAND_COUNT;
    for (let i = 0; i < BAND_COUNT; i++) {
      let sum = 0;
      const from = Math.floor(i * perBand);
      const to = Math.max(from + 1, Math.floor((i + 1) * perBand));
      for (let j = from; j < to; j++) {
        sum += frequencyData[j] ?? 0;
      }
      bands.push(sum / (to - from) / 255);
    }

    let rms = 0;
    for (const sample of timeData) {
      const normalized = (sample - 128) / 128;
      rms += normalized * normalized;
    }
    const level = Math.min(1, Math.sqrt(rms / timeData.length));

    api.sendLevels({ bands, level });
  }, LEVELS_INTERVAL_MS);
};

const handleDeviceChange = async (api: RecorderWindowApi): Promise<void> => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const currentTrack = current?.stream.getTracks()[0];
  if (currentTrack === undefined) return;
  const stillExists = inputs.some(
    (device) => device.deviceId === currentTrack.getSettings().deviceId
  );
  if (!stillExists) {
    // The chosen device disappeared. Re-acquire to follow the default.
    api.sendStreamState({ live: false, reason: "Microphone device changed" });
    teardown();
    void buildPipeline(api);
  }
};
