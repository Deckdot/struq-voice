/**
 * The recorder bridge: main-side plumbing for the recorder window's IPC.
 * Owns the pending end-capture promise, relays live levels to the overlay,
 * and reports stream state to whoever needs it (hotkey start, session).
 */

import { BrowserWindow, ipcMain } from "electron";
import type { CaptureAudio } from "../session/audio-source";
import type {
  CaptureLevelsChangedEvent,
  RecorderCaptureData,
  RecorderLevels,
  RecorderStreamState
} from "../../shared/ipc";
import {
  captureLevelsChangedChannel,
  recorderCaptureDataChannel,
  recorderLevelsChannel,
  recorderStreamStateChannel
} from "../../shared/ipc";

export interface RecorderBridge {
  waitForCaptureData: (timeoutMs: number) => Promise<CaptureAudio>;
  isLive: () => boolean;
  onStreamState: (listener: (state: RecorderStreamState) => void) => () => void;
}

interface PendingCapture {
  readonly resolve: (audio: CaptureAudio) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export const createRecorderBridge = (): RecorderBridge => {
  let pending: PendingCapture | null = null;
  let live = false;
  const streamStateListeners = new Set<(state: RecorderStreamState) => void>();

  const settlePending = (audio: CaptureAudio | null, error: Error | null): void => {
    if (pending === null) return;
    clearTimeout(pending.timer);
    const { resolve, reject } = pending;
    pending = null;
    if (audio !== null) {
      resolve(audio);
    } else if (error !== null) {
      reject(error);
    }
  };

  ipcMain.on(
    recorderCaptureDataChannel,
    (_event, payload: RecorderCaptureData) => {
      const pcm = new Int16Array(payload.pcm);
      settlePending(
        { pcm, durationMs: payload.durationMs, sampleRate: payload.sampleRate },
        null
      );
    }
  );

  ipcMain.on(recorderLevelsChannel, (_event, payload: RecorderLevels) => {
    if (!live) return;
    const relay: CaptureLevelsChangedEvent = {
      bands: payload.bands,
      level: payload.level
    };
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(captureLevelsChangedChannel, relay);
    }
  });

  ipcMain.on(recorderStreamStateChannel, (_event, payload: RecorderStreamState) => {
    live = payload.live;
    for (const listener of streamStateListeners) {
      listener(payload);
    }
    // A dead stream should not leave a capture hanging forever.
    if (!payload.live) {
      settlePending(
        null,
        new Error(payload.reason ?? "Microphone stream lost")
      );
    }
  });

  return {
    waitForCaptureData: (timeoutMs: number): Promise<CaptureAudio> => {
      if (pending !== null) {
        pending.reject(new Error("Capture already in flight"));
        clearTimeout(pending.timer);
      }
      return new Promise<CaptureAudio>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending !== null) {
            pending = null;
          }
          reject(new Error("Timed out waiting for recorder capture data"));
        }, timeoutMs);
        pending = { resolve, reject, timer };
      });
    },
    isLive: () => live,
    onStreamState: (listener: (state: RecorderStreamState) => void): (() => void) => {
      streamStateListeners.add(listener);
      return () => {
        streamStateListeners.delete(listener);
      };
    }
  };
};
