/**
 * The per-window preload API shapes, declared once here so preloads and
 * renderer env.d.ts share the same types. Types only: no side effects, no
 * Electron imports.
 */

import type { CaptureState } from "./capture";
import type {
  AppReadiness,
  HistoryStatsResult,
  MeetingAssetsResult,
  MeetingAssetProgressEvent,
  MeetingAudioBeginRequest,
  MeetingAudioFrames,
  MeetingAudioArchiveChunk,
  MeetingAudioStateEvent,
  MeetingExportRequest,
  MeetingExportResult,
  MeetingGetRequest,
  MeetingGetResult,
  MeetingLevelsEvent,
  MeetingListRequest,
  MeetingListResult,
  MeetingPauseResult,
  MeetingRenameRequest,
  MeetingRenameSpeakerRequest,
  RecorderBeginCaptureRequest,
  MeetingSearchRequest,
  MeetingSearchResult,
  MeetingSegmentAppendedEvent,
  MeetingSpeakersMergedEvent,
  MeetingSegmentsRequest,
  MeetingSegmentsResult,
  MeetingSimpleResult,
  MeetingStartResult,
  ModelsDownloadProgressEvent,
  TranscriptRecord
} from "./ipc";
import type { ModelsListResult, ModelsModelResult, SettingsUpdateResult } from "./ipc";
import type { OnboardingProfileResult, OnboardingStartRecommendedResult } from "./ipc";
import type { MeetingState } from "./meeting";
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
  /**
   * Ask main to keep live microphone levels flowing while a meter is on
   * screen. Reference counted in main, so several meters can ask at once.
   * Returns the release; call it when the meter unmounts.
   */
  readonly requestCaptureLevels: () => () => void;
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
      listener: (event: ModelsDownloadProgressEvent) => void
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
    update: (patch: Partial<Settings>) => Promise<SettingsUpdateResult>;
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
  readonly meetings: {
    start: () => Promise<MeetingStartResult>;
    stop: () => Promise<MeetingSimpleResult>;
    pause: () => Promise<MeetingPauseResult>;
    list: (request: MeetingListRequest) => Promise<MeetingListResult>;
    get: (request: MeetingGetRequest) => Promise<MeetingGetResult>;
    segments: (request: MeetingSegmentsRequest) => Promise<MeetingSegmentsResult>;
    search: (request: MeetingSearchRequest) => Promise<MeetingSearchResult>;
    remove: (request: MeetingGetRequest) => Promise<MeetingSimpleResult>;
    rename: (request: MeetingRenameRequest) => Promise<MeetingSimpleResult>;
    renameSpeaker: (
      request: MeetingRenameSpeakerRequest
    ) => Promise<MeetingSimpleResult>;
    export: (request: MeetingExportRequest) => Promise<MeetingExportResult>;
    revealRecording: (request: MeetingGetRequest) => Promise<MeetingSimpleResult>;
    assets: () => Promise<MeetingAssetsResult>;
    installAssets: () => Promise<MeetingSimpleResult>;
    onStateChanged: (listener: (state: MeetingState) => void) => () => void;
    onSegmentAppended: (
      listener: (event: MeetingSegmentAppendedEvent) => void
    ) => () => void;
    onSpeakersMerged: (
      listener: (event: MeetingSpeakersMergedEvent) => void
    ) => () => void;
    onLevels: (listener: (event: MeetingLevelsEvent) => void) => () => void;
    onAssetProgress: (
      listener: (event: MeetingAssetProgressEvent) => void
    ) => () => void;
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
  readonly onMeetingStateChanged: (
    listener: (state: MeetingState) => void
  ) => () => void;
  readonly onMeetingLevels: (
    listener: (event: MeetingLevelsEvent) => void
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
  readonly onBeginCapture: (
    callback: (request: RecorderBeginCaptureRequest) => void
  ) => () => void;
  readonly onEndCapture: (callback: () => void) => () => void;
  readonly onDiscardCapture: (callback: () => void) => () => void;
  /**
   * Run the analyser loop, or stop it. Main gates this on demand: a capture,
   * or a window showing a live microphone meter.
   */
  readonly onLevelsEnabled: (callback: (enabled: boolean) => void) => () => void;
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

export interface MeetingWindowApi {
  readonly windowKind: "meeting";
  readonly onBegin: (
    callback: (request: MeetingAudioBeginRequest) => void
  ) => () => void;
  readonly onStop: (callback: () => void) => () => void;
  readonly onPause: (callback: (paused: boolean) => void) => () => void;
  readonly sendFrames: (data: MeetingAudioFrames) => void;
  readonly sendArchiveChunk: (data: MeetingAudioArchiveChunk) => void;
  readonly sendState: (data: MeetingAudioStateEvent) => void;
  readonly sendLevels: (data: MeetingLevelsEvent) => void;
}

export type WindowApi =
  | MainWindowApi
  | OverlayWindowApi
  | RecorderWindowApi
  | MeetingWindowApi;
