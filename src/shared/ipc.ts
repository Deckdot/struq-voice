/**
 * Every IPC channel and payload type lives here and nowhere else.
 * Imported by main, preload and shared code. No side effects, no Electron
 * imports: this module must run in any process.
 */

import type { CaptureState } from "./capture";
import type { HardwareProfile, ModelRecommendation } from "./hardware";
import type { ModelDownloadErrorCode, ModelDownloadState, ModelStatus } from "./models";
import type {
  MeetingRecord,
  MeetingSegment,
  MeetingSpeaker
} from "./meeting";
import type { Settings } from "./settings";
import type { UpdateState } from "./updates";

export const appGetVersionChannel = "app:get-version" as const;
export const appGetReadinessChannel = "app:get-readiness" as const;
export const appReadinessChangedChannel = "app:readiness-changed" as const;

export interface AppReadiness {
  readonly microphone: { readonly live: boolean; readonly reason?: string };
  readonly hotkeysActive: boolean;
}

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

export interface RecorderBeginCaptureRequest {
  readonly maxCaptureMs: number;
  /**
   * Audio kept from before the key went down (ms). Absent means the
   * recorder's own default, which is what every build shipped before the
   * setting was wired through.
   */
  readonly prerollMs?: number;
}

/** Main to recorder: seal the capture after its tail and return the recorded PCM. */
export const recorderEndCaptureChannel = "recorder:end-capture" as const;

/** Main to recorder: abort a capture and throw away the buffer. */
export const recorderDiscardCaptureChannel = "recorder:discard-capture" as const;

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

/**
 * Main to recorder: run the analyser loop, or stop it. Levels are wanted
 * during a capture (the overlay waveform) and while a window shows a live
 * microphone meter (Dictate, the Capture settings tab, onboarding). Outside
 * both, the loop is pure cost, so main gates it on demand.
 */
export const recorderLevelsEnabledChannel = "recorder:levels-enabled" as const;

export interface RecorderLevelsEnabled {
  readonly enabled: boolean;
}

/**
 * Renderer to main: this window wants live microphone levels. Reference
 * counted in main, so the loop runs while at least one window is asking.
 */
export const captureLevelsRequestChannel = "capture:levels-request" as const;

export interface CaptureLevelsRequest {
  readonly wanted: boolean;
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
export const historyStatsChannel = "history:stats" as const;

/** Number of local calendar days shown in the Dictate activity chart. */
export const HISTORY_ACTIVITY_DAYS = 7;

/** One day of dictation, local time, for the activity sparkline. */
export interface HistoryStatsDay {
  readonly dayStartMs: number;
  readonly words: number;
  readonly durationMs: number;
}

/**
 * Aggregates over the whole transcript table, computed in SQL because the
 * renderer must never pull every row to count words. Every field is derived
 * from columns that already exist; nothing here is estimated.
 */
export interface HistoryStatsResult {
  readonly todayWords: number;
  readonly todayDurationMs: number;
  readonly todayCount: number;
  /** Words per minute of speech over the last 30 days, 0 when unknown. */
  readonly wpm: number;
  /** Consecutive local days, ending today, with at least one transcript. */
  readonly streakDays: number;
  readonly totalTranscripts: number;
  readonly totalWords: number;
  readonly totalDurationMs: number;
  /** Oldest first, one entry per day, gaps included as zeroes. */
  readonly daily: readonly HistoryStatsDay[];
}

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

/**
 * Main to renderer: download state changes for one model. Progress events are
 * throttled by the downloader; a terminal event (done or error) is pushed once
 * so the Models view and onboarding never freeze on the last progress tick.
 */
export type ModelsDownloadProgressEvent =
  | {
      readonly state: "downloading";
      readonly modelId: string;
      readonly receivedBytes: number;
      readonly totalBytes: number;
    }
  | { readonly state: "done"; readonly modelId: string }
  | {
      readonly state: "error";
      readonly modelId: string;
      readonly code: ModelDownloadErrorCode;
      readonly message: string;
    };

export const settingsGetChannel = "settings:get" as const;
export const settingsUpdateChannel = "settings:update" as const;
export const settingsChangedChannel = "settings:changed" as const;

export const dictionaryExportChannel = "dictionary:export" as const;
export const dictionaryImportChannel = "dictionary:import" as const;

/** The on-disk interchange format. Versioned so a future shape can be read. */
export interface DictionaryFile {
  readonly kind: "struq-voice-dictionary";
  readonly version: 1;
  readonly entries: readonly {
    readonly from: string;
    readonly to: string;
    readonly matchCase: boolean;
    readonly wholeWord: boolean;
    readonly enabled: boolean;
  }[];
}

export interface DictionaryExportResult {
  readonly ok: boolean;
  /** Absent when the user cancelled the save dialog. */
  readonly path?: string;
  readonly message?: string;
}

export interface DictionaryImportResult {
  readonly ok: boolean;
  /** How many rules were added, ignoring ones that duplicate an existing from. */
  readonly added: number;
  readonly skipped: number;
  readonly message?: string;
}

export interface SettingsGetResult {
  readonly settings: Settings;
}

export interface SettingsUpdateRequest {
  readonly patch: Record<string, unknown>;
}

export interface SettingsUpdateResult {
  readonly settings: Settings;
  /**
   * Set when the change reached memory but not disk (a read-only file, a
   * full volume). The setting applies for this session and is gone at the
   * next boot, so the UI must not report it as saved.
   */
  readonly writeError?: string;
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

/** Push channel: the meeting state changed. Broadcast to every window. */
export const meetingStateChangedChannel = "meeting:state-changed" as const;

export const meetingStartChannel = "meeting:start" as const;
export const meetingStopChannel = "meeting:stop" as const;
export const meetingPauseChannel = "meeting:pause" as const;
export const meetingListChannel = "meeting:list" as const;
export const meetingGetChannel = "meeting:get" as const;
export const meetingSegmentsChannel = "meeting:segments" as const;
export const meetingSearchChannel = "meeting:search" as const;
export const meetingDeleteChannel = "meeting:delete" as const;
export const meetingRenameChannel = "meeting:rename" as const;
export const meetingRenameSpeakerChannel = "meeting:rename-speaker" as const;
export const meetingExportChannel = "meeting:export" as const;
export const meetingRevealRecordingChannel = "meeting:reveal-recording" as const;

/**
 * Push channel: one finished transcript line. Sent as it is written, so the
 * live view appends rather than re-reading the meeting on every utterance.
 */
export const meetingSegmentAppendedChannel = "meeting:segment-appended" as const;

/**
 * Push channel: the clustering decided two speakers were one voice. Sent with
 * the already-persisted segments rewritten, so the live view relabels in place
 * instead of showing a speaker who no longer exists.
 */
export const meetingSpeakersMergedChannel = "meeting:speakers-merged" as const;

/** Push channel: input levels for both lanes, for the live meters. */
export const meetingLevelsChannel = "meeting:levels" as const;

export const meetingAssetsChannel = "meeting:assets" as const;
export const meetingInstallAssetsChannel = "meeting:install-assets" as const;
export const meetingAssetProgressChannel = "meeting:asset-progress" as const;

export interface MeetingStartResult {
  readonly ok: boolean;
  readonly meetingId?: number;
  /** Machine-readable; the renderer translates it. */
  readonly code?: string;
}

export interface MeetingSimpleResult {
  readonly ok: boolean;
}

export interface MeetingPauseResult {
  readonly ok: boolean;
  readonly paused: boolean;
}

export interface MeetingListRequest {
  readonly limit?: number;
  readonly offset?: number;
}

export interface MeetingListResult {
  readonly items: readonly MeetingRecord[];
  readonly total: number;
}

export interface MeetingGetRequest {
  readonly meetingId: number;
}

export interface MeetingGetResult {
  readonly meeting: MeetingRecord | null;
  readonly speakers: readonly MeetingSpeaker[];
}

export interface MeetingSegmentsRequest {
  readonly meetingId: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MeetingSegmentsResult {
  readonly items: readonly MeetingSegment[];
  readonly total: number;
}

export interface MeetingSearchRequest {
  readonly query: string;
  readonly limit?: number;
}

/** A hit carries its meeting so the result list can be grouped without a join. */
export interface MeetingSearchHit {
  readonly segment: MeetingSegment;
  readonly meetingTitle: string;
  readonly meetingStartedAtMs: number;
}

export interface MeetingSearchResult {
  readonly items: readonly MeetingSearchHit[];
}

export interface MeetingRenameRequest {
  readonly meetingId: number;
  readonly title: string;
}

export interface MeetingRenameSpeakerRequest {
  readonly meetingId: number;
  readonly speakerKey: string;
  readonly label: string;
}

export type MeetingExportFormat = "markdown" | "text" | "srt";

export interface MeetingExportRequest {
  readonly meetingId: number;
  readonly format: MeetingExportFormat;
}

export interface MeetingExportResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly code?: string;
}

export interface MeetingSegmentAppendedEvent {
  readonly meetingId: number;
  readonly segment: MeetingSegment;
  readonly speakerCount: number;
}

export interface MeetingSpeakersMergedEvent {
  readonly meetingId: number;
  /** Retired key to surviving key, oldest merge first. */
  readonly merges: readonly { readonly from: string; readonly into: string }[];
  readonly speakerCount: number;
}

export interface MeetingLevelsEvent {
  readonly system: number;
  readonly microphone: number;
}

export interface MeetingAssetStatus {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly bytes: number;
  readonly required: boolean;
  readonly installed: boolean;
  readonly download: ModelDownloadState;
}

export interface MeetingAssetsResult {
  readonly items: readonly MeetingAssetStatus[];
  /** True when every required asset is on disk. */
  readonly ready: boolean;
}

export type MeetingAssetProgressEvent =
  | {
      readonly state: "downloading";
      readonly assetId: string;
      readonly receivedBytes: number;
      readonly totalBytes: number;
    }
  | { readonly state: "done"; readonly assetId: string }
  | {
      readonly state: "error";
      readonly assetId: string;
      readonly code: ModelDownloadErrorCode;
      readonly message: string;
    };

/** Main to meeting window: acquire the loopback stream and start recording. */
export const meetingAudioBeginChannel = "meeting-audio:begin" as const;

export interface MeetingAudioBeginRequest {
  readonly includeMicrophone: boolean;
  readonly archiveAudio: boolean;
  readonly archiveBitrateKbps: number;
  /** Persisted dictation device id, so both lanes use the same microphone. */
  readonly microphoneDeviceId: string | null;
}

/** Main to meeting window: stop both lanes and flush the archive. */
export const meetingAudioStopChannel = "meeting-audio:stop" as const;

/** Main to meeting window: pause or resume the archive recorder. */
export const meetingAudioPauseChannel = "meeting-audio:pause" as const;

/**
 * Meeting window to main: one second of 16 kHz mono Int16 for one lane.
 * `startSample` is the index of the first sample since capture began, which
 * is what makes the two lanes share a clock without a wall-clock timestamp.
 */
export const meetingAudioFramesChannel = "meeting-audio:frames" as const;

export interface MeetingAudioFrames {
  readonly source: "system" | "microphone";
  readonly pcm: ArrayBuffer;
  readonly startSample: number;
  readonly sampleRate: number;
}

/** Meeting window to main: an opus chunk for the archive file. */
export const meetingAudioArchiveChannel = "meeting-audio:archive" as const;

export interface MeetingAudioArchiveChunk {
  readonly bytes: ArrayBuffer;
}

/** Meeting window to main: lane health, and the terminal flush signal. */
export const meetingAudioStateChannel = "meeting-audio:state" as const;

export interface MeetingAudioStateEvent {
  readonly system: { readonly live: boolean; readonly code?: string };
  readonly microphone: { readonly live: boolean; readonly code?: string };
  /** True once every archive chunk has been sent and both lanes are closed. */
  readonly finished: boolean;
}

/** Meeting window to main: 10 Hz levels for the two meters. */
export const meetingAudioLevelsChannel = "meeting-audio:levels" as const;

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
  appReadiness: {
    get: appGetReadinessChannel,
    changed: appReadinessChangedChannel
  },
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
  captureLevelsRequest: captureLevelsRequestChannel,
  capturePartialTranscript: capturePartialTranscriptChannel,
  recorder: {
    begin: recorderBeginCaptureChannel,
    end: recorderEndCaptureChannel,
    discard: recorderDiscardCaptureChannel,
    data: recorderCaptureDataChannel,
    levels: recorderLevelsChannel,
    levelsEnabled: recorderLevelsEnabledChannel,
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
    clear: historyClearChannel,
    stats: historyStatsChannel
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
  dictionary: {
    export: dictionaryExportChannel,
    import: dictionaryImportChannel
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
  },
  meeting: {
    stateChanged: meetingStateChangedChannel,
    start: meetingStartChannel,
    stop: meetingStopChannel,
    pause: meetingPauseChannel,
    list: meetingListChannel,
    get: meetingGetChannel,
    segments: meetingSegmentsChannel,
    search: meetingSearchChannel,
    delete: meetingDeleteChannel,
    rename: meetingRenameChannel,
    renameSpeaker: meetingRenameSpeakerChannel,
    export: meetingExportChannel,
    revealRecording: meetingRevealRecordingChannel,
    segmentAppended: meetingSegmentAppendedChannel,
    speakersMerged: meetingSpeakersMergedChannel,
    levels: meetingLevelsChannel,
    assets: meetingAssetsChannel,
    installAssets: meetingInstallAssetsChannel,
    assetProgress: meetingAssetProgressChannel
  },
  meetingAudio: {
    begin: meetingAudioBeginChannel,
    stop: meetingAudioStopChannel,
    pause: meetingAudioPauseChannel,
    frames: meetingAudioFramesChannel,
    archive: meetingAudioArchiveChannel,
    state: meetingAudioStateChannel,
    levels: meetingAudioLevelsChannel
  }
} as const;

export type PreloadChannels = typeof PRELOAD_CHANNELS;
