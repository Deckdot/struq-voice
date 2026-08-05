/**
 * Every IPC channel and payload type lives here and nowhere else.
 * Imported by main, preload and shared code. No side effects, no Electron
 * imports: this module must run in any process.
 */

import type { CaptureState } from "./capture";
import type { ModelStatus } from "./models";
import type { Settings } from "./settings";

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

/** Main to recorder: switch the microphone to another device. */
export const recorderSetDeviceChannel = "recorder:set-device" as const;

export interface RecorderSetDeviceRequest {
  readonly deviceId: string;
}

/** Main to recorder: ask for the current audio input device list. */
export const recorderGetDevicesChannel = "recorder:get-devices" as const;

/** Recorder to main: the reply to the get-devices request. */
export const recorderDevicesChannel = "recorder:devices" as const;

export interface RecorderDevice {
  readonly deviceId: string;
  readonly label: string;
}

export interface RecorderDevicesEvent {
  readonly devices: readonly RecorderDevice[];
}

/** Main window to main: request the current audio input device list. */
export const devicesListChannel = "devices:list" as const;

export interface DevicesListResult {
  readonly devices: readonly RecorderDevice[];
  /** The persisted deviceId, or null when the default is in use. */
  readonly currentDeviceId: string | null;
}

/** Push channel: live capture levels, relayed to the overlay at 60Hz. */
export const captureLevelsChangedChannel = "capture:levels-changed" as const;

export interface CaptureLevelsChangedEvent {
  readonly bands: readonly number[];
  readonly level: number;
}

/** One history row. The shape both processes share. */
export interface TranscriptRecord {
  readonly id: number;
  readonly text: string;
  readonly engineId: string;
  readonly modelId: string;
  readonly durationMs: number;
  readonly inferenceMs: number | null;
  readonly costUsd: number | null;
  readonly language: string | null;
  readonly createdAtMs: number;
}

export const historyListChannel = "history:list" as const;
export const historySearchChannel = "history:search" as const;
export const historyDeleteChannel = "history:delete" as const;
export const historyClearChannel = "history:clear" as const;

export interface HistoryListRequest {
  readonly limit?: number;
  readonly offset?: number;
}

export interface HistoryListResult {
  readonly items: readonly TranscriptRecord[];
}

export interface HistorySearchRequest {
  readonly query: string;
  readonly limit?: number;
}

export interface HistorySearchResult {
  readonly items: readonly TranscriptRecord[];
}

export interface HistoryDeleteRequest {
  readonly id: number;
}

export interface HistoryDeleteResult {
  readonly ok: boolean;
}

export interface HistoryClearResult {
  readonly ok: boolean;
}

/** Tray recent-transcript re-copy and the History reader's copy action. */
export const clipboardCopyChannel = "clipboard:copy" as const;

export interface ClipboardCopyRequest {
  readonly text: string;
}

export const modelsListChannel = "models:list" as const;
export const modelsDownloadChannel = "models:download" as const;
export const modelsCancelChannel = "models:cancel" as const;
export const modelsDeleteChannel = "models:delete" as const;
export const modelsImportChannel = "models:import" as const;
export const modelsInstallRuntimeChannel = "models:install-runtime" as const;
export const modelsDownloadProgressChannel = "models:download-progress" as const;

export interface ModelsModelRequest {
  readonly modelId: string;
}

export interface ModelsModelResult {
  readonly ok: boolean;
}

export interface ModelsDeleteResult {
  readonly ok: boolean;
}

export interface ModelsImportResult {
  readonly ok: boolean;
  readonly message?: string;
}

export interface ModelsListResult {
  readonly items: readonly ModelStatus[];
  /** Total bytes used by every installed model, for the Models view. */
  readonly totalDiskUsed: number;
  readonly whisperRuntime: {
    readonly state: "idle" | "downloading" | "done" | "error";
    readonly receivedBytes?: number;
    readonly totalBytes?: number;
    readonly message?: string;
  };
}

/** Main to renderer: download progress for one model, unthrottled. */
export interface ModelsDownloadProgressEvent {
  readonly modelId: string;
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

export const settingsGetChannel = "settings:get" as const;
export const settingsUpdateChannel = "settings:update" as const;
export const settingsChangedChannel = "settings:changed" as const;

export interface SettingsGetResult {
  readonly settings: Settings;
}

export interface SettingsUpdateRequest {
  readonly patch: Record<string, unknown>;
}

export interface SettingsUpdateResult {
  readonly settings: Settings;
}

export interface SettingsChangedEvent {
  readonly settings: Settings;
}

export const openRouterKeyStatusChannel = "secrets:openrouter-status" as const;
export const openRouterKeySetChannel = "secrets:openrouter-set" as const;
export const openRouterKeyClearChannel = "secrets:openrouter-clear" as const;

export interface OpenRouterKeyStatusResult {
  /** True when a key is stored, or env-provided. */
  readonly configured: boolean;
  /** True only when stored in safeStorage (a "Replace key" placeholder shows). */
  readonly stored: boolean;
}

export interface OpenRouterKeySetRequest {
  readonly key: string;
}

export interface OpenRouterKeyMutationResult {
  readonly ok: boolean;
  readonly message?: string;
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
    streamState: recorderStreamStateChannel,
    setDevice: recorderSetDeviceChannel,
    getDevices: recorderGetDevicesChannel,
    devices: recorderDevicesChannel
  },
  history: {
    list: historyListChannel,
    search: historySearchChannel,
    delete: historyDeleteChannel,
    clear: historyClearChannel
  },
  clipboard: {
    copy: clipboardCopyChannel
  },
  settings: {
    get: settingsGetChannel,
    update: settingsUpdateChannel,
    changed: settingsChangedChannel
  },
  devices: {
    list: devicesListChannel
  },
  openRouterKey: {
    status: openRouterKeyStatusChannel,
    set: openRouterKeySetChannel,
    clear: openRouterKeyClearChannel
  },
  models: {
    list: modelsListChannel,
    download: modelsDownloadChannel,
    cancel: modelsCancelChannel,
    delete: modelsDeleteChannel,
    import: modelsImportChannel,
    installRuntime: modelsInstallRuntimeChannel,
    downloadProgress: modelsDownloadProgressChannel
  }
} as const;

export type PreloadChannels = typeof PRELOAD_CHANNELS;
