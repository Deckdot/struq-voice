/**
 * The per-window preload API shapes, declared once here so preloads and
 * renderer env.d.ts share the same types. Types only: no side effects, no
 * Electron imports.
 */

import type { CaptureState } from "./capture";
import type { TranscriptRecord } from "./ipc";
import type { ModelsListResult, ModelsModelResult } from "./ipc";
import type { Settings } from "./settings";

export interface MainWindowApi {
  readonly windowKind: "main";
  readonly getAppVersion: () => Promise<string>;
  readonly window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
  };
  readonly onCaptureStateChanged: (
    listener: (state: CaptureState) => void
  ) => () => void;
  readonly history: {
    list: (request: { limit?: number; offset?: number }) => Promise<{
      items: readonly TranscriptRecord[];
    }>;
    search: (request: { query: string; limit?: number }) => Promise<{
      items: readonly TranscriptRecord[];
    }>;
    remove: (request: { id: number }) => Promise<{ ok: boolean }>;
    clear: () => Promise<{ ok: boolean }>;
  };
  readonly models: {
    list: () => Promise<ModelsListResult>;
    download: (request: { modelId: string }) => Promise<ModelsModelResult>;
    cancel: (request: { modelId: string }) => Promise<ModelsModelResult>;
    remove: (request: { modelId: string }) => Promise<ModelsModelResult>;
    onDownloadProgress: (
      listener: (event: {
        modelId: string;
        receivedBytes: number;
        totalBytes: number;
      }) => void
    ) => () => void;
  };
  readonly clipboard: {
    copy: (text: string) => void;
  };
  readonly settings: {
    get: () => Promise<{ settings: Settings }>;
    update: (patch: Partial<Settings>) => Promise<{ settings: Settings }>;
    onChange: (listener: (settings: Settings) => void) => () => void;
  };
  readonly openRouterKey: {
    status: () => Promise<{ configured: boolean; stored: boolean }>;
    set: (key: string) => Promise<{ ok: boolean; message?: string }>;
    clear: () => Promise<{ ok: boolean; message?: string }>;
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
