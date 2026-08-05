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
}

export interface RecorderWindowApi {
  readonly windowKind: "recorder";
}

export type WindowApi = MainWindowApi | OverlayWindowApi | RecorderWindowApi;
