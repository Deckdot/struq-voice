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
  captureStateChanged: captureStateChangedChannel
} as const;

export type PreloadChannels = typeof PRELOAD_CHANNELS;
