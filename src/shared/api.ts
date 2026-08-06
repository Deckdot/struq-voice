/**
 * The per-window preload API shapes, declared once here so preloads and
 * renderer env.d.ts share the same types. Types only: no side effects, no
 * Electron imports.
 */

import type { CaptureState } from "./capture";
import type { AppReadiness, HistoryStatsResult, TranscriptRecord } from "./ipc";
import type { ModelsListResult, ModelsModelResult } from "./ipc";
import type { OnboardingProfileResult, OnboardingStartRecommendedResult } from "./ipc";
import type { Settings } from "./settings";
import type { UpdateState } from "./updates";

export interface MainWindowApi {
  readonly windowKind: "main";
  readonly initialTheme: "light" | "dark";
  readonly initialLocale: string;
  readonly initialDir: "ltr" | "rtl";
  readonly getAppVersion: () => Promise<string>;
  readonly getReadiness: () => Promise<AppReadiness>;
  readonly onReadinessChanged: (listener: (state: AppReadiness) => void) => () => void;
  readonly window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
  };
  readonly onCaptureStateChanged: (
    listener: (state: CaptureState) => void
  ) => () => void;
  readonly onCaptureLevelsChanged: (
    listener: (data: { bands: readonly number[]; level: number }) => void
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
    stats: () => Promise<HistoryStatsResult>;
  };
  readonly models: {
    list: () => Promise<ModelsListResult>;
    download: (request: { modelId: string }) => Promise<ModelsModelResult>;
    cancel: (request: { modelId: string }) => Promise<ModelsModelResult>;
    remove: (request: { modelId: string }) => Promise<ModelsModelResult>;
    installRuntime: () => Promise<ModelsModelResult>;
    import: (request: { modelId: string }) => Promise<{
      ok: boolean;
      message?: string;
    }>;
    onDownloadProgress: (
      listener: (event: {
        modelId: string;
        receivedBytes: number;
        totalBytes: number;
      }) => void
    ) => () => void;
  };
  readonly metrics: {
    measuredRtf: () => Promise<{ byEngine: Record<string, number> }>;
  };
  readonly clipboard: {
    copy: (text: string) => void;
  };
  readonly settings: {
    get: () => Promise<{ settings: Settings }>;
    update: (patch: Partial<Settings>) => Promise<{ settings: Settings }>;
    onChange: (listener: (settings: Settings) => void) => () => void;
  };
  readonly dictionary: {
    export: () => Promise<{ ok: boolean; path?: string; message?: string }>;
    import: () => Promise<{ ok: boolean; added: number; skipped: number; message?: string }>;
  };
  readonly openRouterKey: {
    status: () => Promise<{ configured: boolean; stored: boolean }>;
    set: (key: string) => Promise<{ ok: boolean; message?: string }>;
    clear: () => Promise<{ ok: boolean; message?: string }>;
  };
  readonly devices: {
    list: () => Promise<{ devices: readonly RecorderDevice[]; currentDeviceId: string | null }>;
    setDevice: (deviceId: string) => void;
  };
  readonly updates: {
    get: () => Promise<{ state: UpdateState; currentVersion: string }>;
    check: () => Promise<{ state: UpdateState; currentVersion: string }>;
    install: () => Promise<{ started: boolean }>;
    onChange: (listener: (state: UpdateState) => void) => () => void;
  };
  readonly onboarding: {
    profile: () => Promise<OnboardingProfileResult>;
    /** Selects the recommended engine and starts its download. */
    startRecommended: () => Promise<OnboardingStartRecommendedResult>;
    complete: () => Promise<{ settings: Settings }>;
  };
}

export interface OverlayWindowApi {
  readonly windowKind: "overlay";
  readonly initialTheme: "light" | "dark";
  readonly initialLocale: string;
  readonly initialDir: "ltr" | "rtl";
  readonly onCaptureStateChanged: (
    listener: (state: CaptureState, liveTranscription: boolean) => void
  ) => () => void;
  readonly onCaptureLevelsChanged: (
    listener: (data: { bands: readonly number[]; level: number }) => void
  ) => () => void;
  readonly onPartialTranscript: (
    listener: (data: {
      text: string;
      durationMs: number;
      sequence: number;
    }) => void
  ) => () => void;
  /**
   * Move the panel to absolute screen coordinates. The overlay cannot be
   * dragged by the OS (focusable: false keeps paste delivery working), so the
   * renderer tracks the pointer and calls this; main clamps to a display.
   */
  readonly move: (x: number, y: number) => void;
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
  /**
   * Play a capture sound. Main sends the decoded file bytes rather than a
   * path: the recorder is sandboxed and cannot read from disk itself.
   */
  readonly onPlaySound: (
    callback: (data: { bytes: ArrayBuffer; volume: number }) => void
  ) => () => void;
  readonly onSnapshotRequest: (callback: (sequence: number) => void) => () => void;
  readonly sendSnapshotData: (data: {
    pcm: ArrayBuffer;
    durationMs: number;
    sampleRate: number;
    sequence: number;
  }) => void;
  readonly onSetDevice: (callback: (deviceId: string) => void) => () => void;
  readonly onGetDevices: (callback: () => void) => () => void;
  readonly sendDevices: (
    devices: readonly RecorderDevice[],
    currentDeviceId: string | null
  ) => void;
}

export interface RecorderDevice {
  readonly deviceId: string;
  readonly label: string;
}

export type WindowApi = MainWindowApi | OverlayWindowApi | RecorderWindowApi;
