/**
 * Every IPC channel and payload type lives here and nowhere else.
 * Imported by main, preload and shared code. No side effects, no Electron
 * imports: this module must run in any process.
 */

import type { CaptureState } from "./capture";

export const appGetVersionChannel = "app:get-version" as const;

export const windowMinimizeChannel = "window:minimize" as const;
export const windowToggleMaximizeChannel = "window:toggle-maximize" as const;
export const windowCloseChannel = "window:close" as const;

/** Push channel: the capture state changed. Broadcast to every window. */
export const captureStateChangedChannel = "capture:state-changed" as const;

export interface CaptureStateChangedEvent {
  readonly state: CaptureState;
}

/** Main to recorder: start appending to the active capture buffer. */
export const recorderBeginCaptureChannel = "recorder:begin-capture" as const;

/** Main to recorder: stop the capture and return the recorded PCM. */
export const recorderEndCaptureChannel = "recorder:end-capture" as const;

/** Recorder to main: the captured PCM, as a transferable Int16 ArrayBuffer. */
export const recorderCaptureDataChannel = "recorder:capture-data" as const;

export interface RecorderCaptureData {
  readonly pcm: ArrayBuffer;
  readonly durationMs: number;
  readonly sampleRate: number;
}

/** Recorder to main: live analyser data at 60Hz. */
export const recorderLevelsChannel = "recorder:levels" as const;

export interface RecorderLevels {
  readonly bands: readonly number[];
  readonly level: number;
}

/** Recorder to main: microphone stream state changes. */
export const recorderStreamStateChannel = "recorder:stream-state" as const;

export interface RecorderStreamState {
  readonly live: boolean;
  readonly reason?: string;
}

/** Push channel: live capture levels, relayed to the overlay at 60Hz. */
export const captureLevelsChangedChannel = "capture:levels-changed" as const;

export interface CaptureLevelsChangedEvent {
  readonly bands: readonly number[];
  readonly level: number;
}

/**
 * The channels sandboxed preloads need at runtime, in one object. Sandboxed
 * preloads cannot load shared modules (the bundle must be a single file), so
 * main serialises this object into the window's additionalArguments and each
 * preload reads it from process.argv. Declared here and nowhere else.
 */
export const PRELOAD_CHANNELS = {
  appGetVersion: appGetVersionChannel,
  window: {
    minimize: windowMinimizeChannel,
    toggleMaximize: windowToggleMaximizeChannel,
    close: windowCloseChannel
  },
  captureStateChanged: captureStateChangedChannel,
  captureLevelsChanged: captureLevelsChangedChannel,
  recorder: {
    begin: recorderBeginCaptureChannel,
    end: recorderEndCaptureChannel,
    data: recorderCaptureDataChannel,
    levels: recorderLevelsChannel,
    streamState: recorderStreamStateChannel
  }
} as const;

export type PreloadChannels = typeof PRELOAD_CHANNELS;
