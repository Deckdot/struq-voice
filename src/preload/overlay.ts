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

/**
 * A sandboxed preload gets only contextBridge, ipcRenderer, webFrame and
 * nativeImage from the electron module, so nativeTheme cannot be read here.
 * Main resolves the theme and serialises it into argv alongside the channels.
 * Falling back to light keeps a missing argument cosmetic rather than fatal.
 */
const readTheme = (argv: readonly string[]): "light" | "dark" =>
  argv.includes("--struq-theme=dark") ? "dark" : "light";

const readLocale = (argv: readonly string[]): string => {
  const arg = argv.find((entry) => entry.startsWith("--struq-locale="));
  return arg !== undefined ? arg.slice("--struq-locale=".length) : "en";
};

const readDir = (argv: readonly string[]): "ltr" | "rtl" => {
  const arg = argv.find((entry) => entry.startsWith("--struq-dir="));
  return arg === "--struq-dir=rtl" ? "rtl" : "ltr";
};

const channels = readChannels(process.argv);

const initialTheme = readTheme(process.argv);
const initialLocale = readLocale(process.argv);
const initialDir = readDir(process.argv);

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
  initialTheme,
  initialLocale,
  initialDir,
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
