import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { OverlayWindowApi } from "../shared/api";
import type { CaptureState } from "../shared/capture";
import type { CaptureStateChangedEvent, PreloadChannels } from "../shared/ipc";

/**
 * Sandboxed preloads cannot load shared modules (the bundle must be one
 * self-contained file), so main serialises the channel names from
 * src/shared/ipc.ts into the window's additionalArguments. Read them here.
 */
const readChannels = (argv: readonly string[]): PreloadChannels => {
  const arg = argv.find((entry) => entry.startsWith("--struq-channels="));
  if (arg === undefined) {
    throw new Error("missing --struq-channels argument in preload argv");
  }
  return JSON.parse(arg.slice("--struq-channels=".length)) as PreloadChannels;
};

const channels = readChannels(process.argv);

type CaptureStateListener = (
  state: CaptureState,
  liveTranscription: boolean
) => void;

let latestCaptureState: CaptureStateChangedEvent | null = null;
const captureStateListeners = new Set<CaptureStateListener>();

// The main process replays the current state on did-finish-load, before React
// effects are guaranteed to subscribe. Listen from preload startup and retain
// the event so the first capture cannot disappear between those two moments.
ipcRenderer.on(
  channels.captureStateChanged,
  (_event: IpcRendererEvent, payload: CaptureStateChangedEvent): void => {
    latestCaptureState = payload;
    for (const listener of captureStateListeners) {
      listener(payload.state, payload.liveTranscription ?? false);
    }
  }
);

const api: OverlayWindowApi = {
  windowKind: "overlay",
  onCaptureStateChanged: (
    listener: CaptureStateListener
  ) => {
    captureStateListeners.add(listener);
    if (latestCaptureState !== null) {
      listener(
        latestCaptureState.state,
        latestCaptureState.liveTranscription ?? false
      );
    }
    return () => {
      captureStateListeners.delete(listener);
    };
  },
  onCaptureLevelsChanged: (listener: (data: { bands: readonly number[]; level: number }) => void) => {
    const wrapped = (
      _event: IpcRendererEvent,
      payload: { bands: readonly number[]; level: number }
    ): void => {
      listener(payload);
    };
    ipcRenderer.on(channels.captureLevelsChanged, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.captureLevelsChanged, wrapped);
    };
  },
  onPartialTranscript: (
    listener: (data: { text: string; durationMs: number; sequence: number }) => void
  ) => {
    const wrapped = (
      _event: IpcRendererEvent,
      payload: { text: string; durationMs: number; sequence: number }
    ): void => {
      listener(payload);
    };
    ipcRenderer.on(channels.capturePartialTranscript, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.capturePartialTranscript, wrapped);
    };
  },
  // Explicit numbers, never the caller's arguments: anything non-cloneable
  // crossing contextBridge throws before the send happens.
  move: (x: number, y: number) => {
    ipcRenderer.send(channels.overlay.move, { x, y });
  }
};

contextBridge.exposeInMainWorld("struqVoice", api);
