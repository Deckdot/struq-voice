/**
 * The per-window preload API shapes, declared once here so preloads and
 * renderer env.d.ts share the same types. Types only: no side effects, no
 * Electron imports.
 */

import type { CaptureState } from "./capture";

export interface MainWindowApi {
  readonly windowKind: "main";
  readonly getAppVersion: () => Promise<string>;
  readonly window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
  };
}

export interface OverlayWindowApi {
  readonly windowKind: "overlay";
  readonly onCaptureStateChanged: (
    listener: (state: CaptureState) => void
  ) => () => void;
  readonly onCaptureLevelsChanged: (
    listener: (data: { bands: readonly number[]; level: number }) => void
  ) => () => void;
}

export interface RecorderWindowApi {
  readonly windowKind: "recorder";
  readonly isE2E: boolean;
  readonly onBeginCapture: (callback: () => void) => () => void;
  readonly onEndCapture: (callback: () => void) => () => void;
  readonly sendCaptureData: (data: {
    pcm: ArrayBuffer;
    durationMs: number;
    sampleRate: number;
  }) => void;
  readonly sendLevels: (data: { bands: readonly number[]; level: number }) => void;
  readonly sendStreamState: (data: { live: boolean; reason?: string }) => void;
}

export type WindowApi = MainWindowApi | OverlayWindowApi | RecorderWindowApi;
