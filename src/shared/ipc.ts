/**
 * Every IPC channel and payload type lives here and nowhere else.
 * Imported by main, preload and shared code. No side effects, no Electron
 * imports: this module must run in any process.
 */

import type { CaptureState } from "./capture";
import type { HardwareProfile, ModelRecommendation } from "./hardware";
import type { ModelStatus } from "./models";
import type { Settings } from "./settings";
import type { UpdateState } from "./updates";

export const appGetVersionChannel = "app:get-version" as const;

export const windowMinimizeChannel = "window:minimize" as const;
export const windowToggleMaximizeChannel = "window:toggle-maximize" as const;
export const windowCloseChannel = "window:close" as const;

/**
 * Overlay to main: move the capture panel to a screen position. The overlay
 * is `focusable: false` so that a synthesised paste lands in the user's app
 * rather than in ours, which also means Windows will not drag it and
 * -webkit-app-region does nothing. The renderer tracks the pointer itself and
 * sends absolute screen coordinates; main clamps them to a visible display.
 */
export const overlayMoveChannel = "overlay:move" as const;

export interface OverlayMoveRequest {
  readonly x: number;
  readonly y: number;
}

/** Push channel: the capture state changed. Broadcast to every window. */
export const captureStateChangedChannel = "capture:state-changed" as const;

export interface CaptureStateChangedEvent {
  readonly state: CaptureState;
  /**
   * Whether the live transcript is switched on, so the capture panel can say
   * "waiting for the first words" rather than "it is off" while the first
   * partial is still being decoded. Optional: older senders omit it.
   */
  readonly liveTranscription?: boolean;
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

/**
 * Push channel: the running transcript while a capture is still open, so the
 * user can see that what they said was heard correctly during a long
 * dictation. Partials come from re-decoding the audio so far on an interval,
 * never from the delivery path: `text` here is provisional and is always
 * superseded by the final transcript.
 */
export const capturePartialTranscriptChannel = "capture:partial-transcript" as const;

export interface CapturePartialTranscriptEvent {
  readonly text: string;
  /** Audio covered by this partial, so the UI can show progress. */
  readonly durationMs: number;
  /** Rises with each partial in a capture; the UI drops stale ones. */
  readonly sequence: number;
}

/**
 * Main to recorder: play a capture sound.
 *
 * The recorder window plays them because it is hidden, permanently alive and
 * already owns audio. Playing from a visible window would mean creating or
 * showing one mid-capture, and anything that touches the foreground breaks
 * the paste that the whole product depends on.
 */
export const recorderPlaySoundChannel = "recorder:play-sound" as const;

export type CaptureSound = "open" | "close";

export interface RecorderPlaySoundRequest {
  readonly sound: CaptureSound;
  readonly volume: number;
}

/** Main to recorder: copy the capture buffer so far without ending it. */
export const recorderSnapshotRequestChannel = "recorder:snapshot-request" as const;

export interface RecorderSnapshotRequest {
  readonly sequence: number;
}

/** Recorder to main: the audio captured so far, for a partial decode. */
export const recorderSnapshotDataChannel = "recorder:snapshot-data" as const;

export interface RecorderSnapshotData {
  readonly pcm: ArrayBuffer;
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly sequence: number;
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

export const metricsMeasuredRtfChannel = "metrics:measured-rtf" as const;

export interface MetricsMeasuredRtfResult {
  readonly byEngine: Record<string, number>;
}

/** Update channel: check, install, and the state broadcast behind both. */
export const updatesGetChannel = "updates:get" as const;
export const updatesCheckChannel = "updates:check" as const;
export const updatesInstallChannel = "updates:install" as const;
export const updatesChangedChannel = "updates:changed" as const;

export interface UpdatesStateResult {
  readonly state: UpdateState;
  /** The running version, so Settings can show it beside the update state. */
  readonly currentVersion: string;
}

export interface UpdatesInstallResult {
  /** False when nothing is ready to install, so the click is a no-op. */
  readonly started: boolean;
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

export const onboardingProfileChannel = "onboarding:get-profile" as const;
export const onboardingStartRecommendedChannel = "onboarding:start-recommended" as const;
export const onboardingCompleteChannel = "onboarding:complete" as const;

export interface OnboardingProfileResult {
  /** Null when detection has not finished, or failed outright. */
  readonly hardware: HardwareProfile | null;
  readonly recommendation: ModelRecommendation;
  /** True when the recommended model is already on disk. */
  readonly modelInstalled: boolean;
}

/**
 * Sets the recommended engine and starts its model download in one call, so
 * the renderer does not have to sequence two operations and handle a partial
 * failure between them.
 */
export interface OnboardingStartRecommendedResult {
  readonly modelId: string;
  readonly started: boolean;
  readonly message?: string;
}

export interface OnboardingCompleteResult {
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
  overlay: {
    move: overlayMoveChannel
  },
  captureStateChanged: captureStateChangedChannel,
  captureLevelsChanged: captureLevelsChangedChannel,
  capturePartialTranscript: capturePartialTranscriptChannel,
  recorder: {
    begin: recorderBeginCaptureChannel,
    end: recorderEndCaptureChannel,
    data: recorderCaptureDataChannel,
    levels: recorderLevelsChannel,
    streamState: recorderStreamStateChannel,
    setDevice: recorderSetDeviceChannel,
    getDevices: recorderGetDevicesChannel,
    devices: recorderDevicesChannel,
    snapshotRequest: recorderSnapshotRequestChannel,
    snapshotData: recorderSnapshotDataChannel,
    playSound: recorderPlaySoundChannel
  },
  history: {
    list: historyListChannel,
    search: historySearchChannel,
    delete: historyDeleteChannel,
    clear: historyClearChannel
  },
  metrics: {
    measuredRtf: metricsMeasuredRtfChannel
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
  },
  updates: {
    get: updatesGetChannel,
    check: updatesCheckChannel,
    install: updatesInstallChannel,
    changed: updatesChangedChannel
  },
  onboarding: {
    profile: onboardingProfileChannel,
    startRecommended: onboardingStartRecommendedChannel,
    complete: onboardingCompleteChannel
  }
} as const;

export type PreloadChannels = typeof PRELOAD_CHANNELS;
