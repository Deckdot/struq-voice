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
}

let current: AudioPipeline | null = null;
let levelsTimer: ReturnType<typeof setInterval> | null = null;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
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
  void buildPipeline(api);
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
  if (levelsTimer !== null) {
    clearInterval(levelsTimer);
    levelsTimer = null;
  }
  if (monitorTimer !== null) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  if (current !== null) {
    current.unsubscribeBegin();
    current.unsubscribeEnd();
    current.stream.getTracks().forEach((track) => {
      track.stop();
    });
    void current.context.close();
    current = null;
  }
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
  let stream: MediaStream;
  try {
    stream = await acquireStream();
  } catch {
    api.sendStreamState({
      live: false,
      reason: "No microphone found. Plug one in and restart Struq Voice."
    });
    // Keep trying in the background; a hotplug should recover the app.
    setTimeout(() => {
      void buildPipeline(api);
    }, REACQUIRE_GRACE_MS);
    return;
  }

  // The browser resamples to 16kHz, which both engines want. Doing it by
  // hand would be slower and worse.
  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  await context.audioWorklet.addModule(workletUrl);

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 128; // 64 frequency bins, paired into 32 bands
  const worklet = new AudioWorkletNode(context, "pcm-collector");

  source.connect(analyser);
  analyser.connect(worklet);

  const unsubscribeBegin = api.onBeginCapture(() => {
    worklet.port.postMessage({
      type: "arm",
      prerollSamples: Math.floor((TARGET_SAMPLE_RATE * DEFAULT_PREROLL_MS) / 1000)
    });
  });

  const unsubscribeEnd = api.onEndCapture(() => {
    worklet.port.postMessage({ type: "disarm" });
  });

  worklet.port.onmessage = (event: MessageEvent) => {
    const message = event.data as { type?: string; samples?: Float32Array };
    if (message.type !== "capture" || message.samples === undefined) return;
    const samples = message.samples;
    const int16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
      int16[i] = Math.round(clamped * 32767);
    }
    const durationMs = Math.round((samples.length / TARGET_SAMPLE_RATE) * 1000);
    api.sendCaptureData({
      pcm: int16.buffer,
      durationMs,
      sampleRate: TARGET_SAMPLE_RATE
    });
  };

  current = { api, stream, context, analyser, worklet, unsubscribeBegin, unsubscribeEnd };

  api.sendStreamState({ live: true });

  // The microphone's own lifecycle: track.onended fires on unplug or driver
  // reset. A dead mic must never silently produce empty transcripts.
  stream.getTracks()[0]?.addEventListener("ended", () => {
    api.sendStreamState({ live: false, reason: "Microphone disconnected" });
    teardown();
    setTimeout(() => {
      void buildPipeline(api);
    }, REACQUIRE_GRACE_MS);
  });

  // Some drivers report mute before onended. Re-acquire if it does not
  // recover on its own.
  monitorTimer = setInterval(() => {
    const track = current?.stream.getTracks()[0];
    if (track !== undefined && track.muted) {
      setTimeout(() => {
        if (track.muted) {
          api.sendStreamState({ live: false, reason: "Microphone muted" });
          teardown();
          void buildPipeline(api);
        }
      }, REACQUIRE_GRACE_MS);
    }
  }, 5000);

  startLevelsLoop();

  if (!deviceChangeListenerAttached) {
    deviceChangeListenerAttached = true;
    // Windows rotates device IDs across reboots and hotplugs change the
    // default device. Re-enumerate and follow the default when it moves.
    navigator.mediaDevices.addEventListener("devicechange", () => {
      void handleDeviceChange(api);
    });
  }
};

const startLevelsLoop = (): void => {
  if (levelsTimer !== null) {
    clearInterval(levelsTimer);
  }
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
