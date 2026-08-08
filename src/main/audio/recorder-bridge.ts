/**
 * The recorder bridge: main-side plumbing for the recorder window's IPC.
 * Owns the pending end-capture promise, relays live levels to the overlay,
 * and reports stream state to whoever needs it (hotkey start, session).
 */

import { BrowserWindow, ipcMain } from "electron";
import type { CaptureAudio } from "../session/audio-source";
import type {
  CaptureLevelsChangedEvent,
  CaptureLevelsRequest,
  RecorderCaptureData,
  RecorderLevels,
  RecorderLevelsEnabled,
  RecorderSnapshotData,
  RecorderSnapshotRequest,
  RecorderStreamState
} from "../../shared/ipc";
import {
  captureLevelsChangedChannel,
  captureLevelsRequestChannel,
  recorderCaptureDataChannel,
  recorderLevelsChannel,
  recorderLevelsEnabledChannel,
  recorderSnapshotDataChannel,
  recorderSnapshotRequestChannel,
  recorderStreamStateChannel
} from "../../shared/ipc";

export interface RecorderBridge {
  waitForCaptureData: (timeoutMs: number) => Promise<CaptureAudio>;
  isLive: () => boolean;
  onStreamState: (listener: (state: RecorderStreamState) => void) => () => void;
  /**
   * Copy the audio captured so far without ending the capture, for a partial
   * transcript. Resolves null when the recorder does not answer in time: a
   * partial is cosmetic, so a slow reply is dropped rather than retried.
   */
  requestSnapshot: (timeoutMs: number) => Promise<CaptureAudio | null>;
  /**
   * Hold the analyser loop open. The capture session holds one of these for
   * the duration of a capture (the overlay waveform reads it); windows
   * showing a microphone meter hold their own. The loop runs while at least
   * one holder is outstanding. Returns the release.
   */
  holdLevels: () => () => void;
}

interface PendingCapture {
  readonly resolve: (audio: CaptureAudio) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingSnapshot {
  readonly resolve: (audio: CaptureAudio | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export const createRecorderBridge = (): RecorderBridge => {
  let pending: PendingCapture | null = null;
  let live = false;
  const streamStateListeners = new Set<(state: RecorderStreamState) => void>();

  // Snapshots are keyed by sequence: several can be outstanding if a decode
  // runs long, and a late reply must never resolve a newer request.
  let snapshotSequence = 0;
  const pendingSnapshots = new Map<number, PendingSnapshot>();

  const findRecorderWindow = (): BrowserWindow | null =>
    BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes("recorder/index.html")
    ) ?? null;

  /**
   * The capture data plane resolves the pending transcription promise, so
   * only the recorder window may speak on it. Any other renderer is ignored.
   */
  const isRecorderWindow = (sender: Electron.WebContents): boolean =>
    sender.getURL().includes("recorder/index.html");

  ipcMain.on(
    recorderSnapshotDataChannel,
    (event, payload: RecorderSnapshotData) => {
      if (!isRecorderWindow(event.sender)) return;
      const waiting = pendingSnapshots.get(payload.sequence);
      if (waiting === undefined) return;
      pendingSnapshots.delete(payload.sequence);
      clearTimeout(waiting.timer);
      waiting.resolve({
        pcm: new Int16Array(payload.pcm),
        durationMs: payload.durationMs,
        sampleRate: payload.sampleRate
      });
    }
  );

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
    (event, payload: RecorderCaptureData) => {
      if (!isRecorderWindow(event.sender)) return;
      const pcm = new Int16Array(payload.pcm);
      settlePending(
        { pcm, durationMs: payload.durationMs, sampleRate: payload.sampleRate },
        null
      );
    }
  );

  // Demand for the 60Hz analyser loop. Held by an active capture and by every
  // window showing a microphone meter. At zero the recorder stops the loop:
  // running it while nothing reads it costs CPU and two array allocations per
  // tick for nothing.
  let levelsHolds = 0;
  // Per sender, so a window that closes or reloads without releasing cannot
  // pin the loop on forever.
  const levelsHoldsByWindow = new Map<number, number>();

  const pushLevelsEnabled = (): void => {
    const recorder = findRecorderWindow();
    if (recorder === null) return;
    const payload: RecorderLevelsEnabled = { enabled: levelsHolds > 0 };
    recorder.webContents.send(recorderLevelsEnabledChannel, payload);
  };

  const holdLevels = (): (() => void) => {
    levelsHolds++;
    if (levelsHolds === 1) pushLevelsEnabled();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      levelsHolds = Math.max(0, levelsHolds - 1);
      if (levelsHolds === 0) pushLevelsEnabled();
    };
  };

  const releaseWindowHolds = (windowId: number): void => {
    const held = levelsHoldsByWindow.get(windowId);
    if (held === undefined) return;
    levelsHoldsByWindow.delete(windowId);
    levelsHolds = Math.max(0, levelsHolds - held);
    if (levelsHolds === 0) pushLevelsEnabled();
  };

  ipcMain.on(
    captureLevelsRequestChannel,
    (event, payload: CaptureLevelsRequest) => {
      const windowId = event.sender.id;
      const held = levelsHoldsByWindow.get(windowId) ?? 0;
      if (payload.wanted) {
        levelsHoldsByWindow.set(windowId, held + 1);
        levelsHolds++;
        if (levelsHolds === 1) pushLevelsEnabled();
        if (held === 0) {
          // The renderer's release never arrives if the window closes or
          // navigates, so tie the holds to the sender's lifetime too. A
          // reload re-runs the effects and re-asks from zero.
          const sender = event.sender;
          const onGone = (): void => {
            releaseWindowHolds(windowId);
          };
          sender.once("destroyed", onGone);
          // A reload tears the renderer's effects down without a release.
          // did-finish-load only fires for a real document load, so an
          // in-page route change cannot drop a hold that is still wanted.
          sender.once("did-finish-load", onGone);
        }
        return;
      }
      if (held === 0) return;
      if (held === 1) {
        levelsHoldsByWindow.delete(windowId);
      } else {
        levelsHoldsByWindow.set(windowId, held - 1);
      }
      levelsHolds = Math.max(0, levelsHolds - 1);
      if (levelsHolds === 0) pushLevelsEnabled();
    }
  );

  ipcMain.on(recorderLevelsChannel, (event, payload: RecorderLevels) => {
    if (!isRecorderWindow(event.sender)) return;
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

  ipcMain.on(recorderStreamStateChannel, (event, payload: RecorderStreamState) => {
    if (!isRecorderWindow(event.sender)) return;
    live = payload.live;
    // The recorder announces a live stream once its pipeline is built, which
    // is the first moment it can act on this. Re-push so a hold taken before
    // the window existed (or before a rebuild) is not lost.
    if (payload.live) pushLevelsEnabled();
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
    requestSnapshot: (timeoutMs: number): Promise<CaptureAudio | null> => {
      const recorder = findRecorderWindow();
      if (recorder === null) return Promise.resolve(null);

      const sequence = ++snapshotSequence;
      const request: RecorderSnapshotRequest = { sequence };
      recorder.webContents.send(recorderSnapshotRequestChannel, request);

      return new Promise<CaptureAudio | null>((resolve) => {
        const timer = setTimeout(() => {
          pendingSnapshots.delete(sequence);
          resolve(null);
        }, timeoutMs);
        pendingSnapshots.set(sequence, { resolve, timer });
      });
    },
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
    holdLevels,
    onStreamState: (listener: (state: RecorderStreamState) => void): (() => void) => {
      streamStateListeners.add(listener);
      return () => {
        streamStateListeners.delete(listener);
      };
    }
  };
};
