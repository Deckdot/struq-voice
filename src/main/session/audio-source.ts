/**
 * Capture audio sources. Phase 2 introduces the real recorder-window source;
 * the simulated source keeps the session testable without a microphone.
 */

import type { BrowserWindow } from "electron";
import type { RecorderBridge } from "../audio/recorder-bridge";
import { recorderBeginCaptureChannel, recorderEndCaptureChannel } from "../../shared/ipc";

export interface CaptureAudio {
  /** Int16 PCM, 16kHz mono. */
  readonly pcm: Int16Array;
  readonly durationMs: number;
  readonly sampleRate: number;
}

export interface CaptureAudioSource {
  beginCapture: () => void;
  endCapture: () => Promise<CaptureAudio>;
  isLive: () => boolean;
}

const CAPTURE_TIMEOUT_MS = 5_000;

export const createRecorderAudioSource = (
  recorderWindow: BrowserWindow,
  bridge: RecorderBridge
): CaptureAudioSource => {
  return {
    beginCapture: () => {
      if (recorderWindow.isDestroyed()) return;
      recorderWindow.webContents.send(recorderBeginCaptureChannel);
    },
    endCapture: () => {
      if (recorderWindow.isDestroyed()) {
        return Promise.reject(new Error("Recorder window is gone"));
      }
      recorderWindow.webContents.send(recorderEndCaptureChannel);
      return bridge.waitForCaptureData(CAPTURE_TIMEOUT_MS);
    },
    isLive: () => bridge.isLive()
  };
};

/**
 * Test-only source: one second of a quiet 440Hz tone, so the full session
 * journey runs without a microphone and captures still produce real PCM.
 */
export const createSimulatedAudioSource = (): CaptureAudioSource => {
  return {
    beginCapture: () => {
      // Nothing to arm; the tone is generated on end.
    },
    endCapture: () => {
      const sampleRate = 16_000;
      const samples = sampleRate; // one second
      const pcm = new Int16Array(samples);
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        pcm[i] = Math.round(Math.sin(2 * Math.PI * 440 * t) * 4000);
      }
      return Promise.resolve({ pcm, durationMs: 1000, sampleRate });
    },
    isLive: () => false
  };
};
