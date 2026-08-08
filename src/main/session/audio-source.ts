/**
 * Capture audio sources. Phase 2 introduces the real recorder-window source;
 * the simulated source keeps the session testable without a microphone.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { RecorderBridge } from "../audio/recorder-bridge";
import {
  recorderBeginCaptureChannel,
  recorderDiscardCaptureChannel,
  recorderEndCaptureChannel
} from "../../shared/ipc";

export interface CaptureAudio {
  /** Int16 PCM, 16kHz mono. */
  readonly pcm: Int16Array;
  readonly durationMs: number;
  readonly sampleRate: number;
}

export interface CaptureAudioSource {
  beginCapture: () => void;
  endCapture: () => Promise<CaptureAudio>;
  /** Abort the active capture without waiting for PCM. */
  discardCapture: () => void;
  isLive: () => boolean;
}

const CAPTURE_TIMEOUT_MS = 5_000;

export const createRecorderAudioSource = (
  recorderWindow: BrowserWindow,
  bridge: RecorderBridge
): CaptureAudioSource => {
  // The overlay waveform reads levels, so the analyser loop must run for the
  // life of a capture. Held here rather than in the session because these
  // three calls are exactly the capture's boundaries.
  let releaseLevels: (() => void) | null = null;

  const dropLevelsHold = (): void => {
    const release = releaseLevels;
    releaseLevels = null;
    release?.();
  };

  return {
    beginCapture: () => {
      if (recorderWindow.isDestroyed()) return;
      // A capture that never ended (a lost end-capture) would otherwise pin
      // the loop on, so replace rather than stack.
      dropLevelsHold();
      releaseLevels = bridge.holdLevels();
      recorderWindow.webContents.send(recorderBeginCaptureChannel);
    },
    endCapture: () => {
      dropLevelsHold();
      if (recorderWindow.isDestroyed()) {
        return Promise.reject(new Error("Recorder window is gone"));
      }
      recorderWindow.webContents.send(recorderEndCaptureChannel);
      return bridge.waitForCaptureData(CAPTURE_TIMEOUT_MS);
    },
    discardCapture: () => {
      dropLevelsHold();
      if (recorderWindow.isDestroyed()) return;
      recorderWindow.webContents.send(recorderDiscardCaptureChannel);
    },
    isLive: () => bridge.isLive()
  };
};

/**
 * Test-only source: real fixture PCM (e2e/fixtures/sample-16k-mono.pcm)
 * when present, otherwise one second of a quiet 440Hz tone, so the full
 * session journey runs without a microphone and captures still produce real
 * PCM.
 */
export const createSimulatedAudioSource = (appPath: string): CaptureAudioSource => {
  const loadFixture = (): Int16Array | null => {
    try {
      const bytes = readFileSync(join(appPath, "e2e", "fixtures", "sample-16k-mono.pcm"));
      return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    } catch {
      return null;
    }
  };

  return {
    beginCapture: () => {
      // Nothing to arm; the PCM is returned on end.
    },
    endCapture: () => {
      const sampleRate = 16_000;
      const fixture = loadFixture();
      if (fixture !== null) {
        const durationMs = Math.round((fixture.length / sampleRate) * 1000);
        return Promise.resolve({ pcm: fixture, durationMs, sampleRate });
      }
      const samples = sampleRate; // one second
      const pcm = new Int16Array(samples);
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        pcm[i] = Math.round(Math.sin(2 * Math.PI * 440 * t) * 4000);
      }
      return Promise.resolve({ pcm, durationMs: 1000, sampleRate });
    },
    discardCapture: () => {
      // Nothing to discard; the simulated source holds no state.
    },
    isLive: () => false
  };
};
