/**
 * THE meeting state machine. One authority, in the main process. Tray, main
 * window and tests all render from broadcasts of it. Nothing else owns
 * meeting state.
 *
 *   idle --start--> starting --lanes live--> recording --stop--> finalizing
 *     --drained--> idle
 *
 * recording --pause--> paused --togglePause--> recording
 * starting / recording / finalizing --fail--> error --start--> idle
 *
 * A meeting is refused up front when the store is missing, the assets are
 * missing, or another meeting is already running. The audio window is
 * created on demand and destroyed on stop; an idle app pays nothing for this
 * feature.
 *
 * Main never holds audio: frames from the meeting window are forwarded to
 * the worker straight through, archive chunks go to the file writer, and
 * finished segments come back as rows.
 */

import type { BrowserWindow } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { MeetingSettings } from "../../shared/settings";
import type {
  MeetingLaneErrorCode,
  MeetingLaneHealth,
  MeetingSegment,
  MeetingState
} from "../../shared/meeting";
import { INITIAL_MEETING_STATE, isMeetingActive } from "../../shared/meeting";
import type {
  MeetingAudioStateEvent,
  MeetingSegmentAppendedEvent,
  MeetingStartResult
} from "../../shared/ipc";
import type { ArchiveWriter } from "./archive-writer";
import type { MeetingAssetService } from "./assets";
import type { MeetingStore } from "../db/meeting-store";
import type { MeetingWorkerClient } from "./worker-client";
import type { WorkerFrames, WorkerInit } from "./worker/protocol";

const LANE_LIVE_TIMEOUT_MS = 8000;
const WINDOW_STOP_TIMEOUT_MS = 5000;
const WORKER_DRAIN_TIMEOUT_MS = 30_000;

export interface MeetingSessionOptions {
  readonly settings: () => MeetingSettings;
  readonly speechLanguage: () => string;
  readonly store: MeetingStore | null;
  readonly worker: MeetingWorkerClient;
  readonly window: {
    create: () => Promise<BrowserWindow>;
    destroy: () => void;
  };
  readonly archive: ArchiveWriter;
  readonly assets: MeetingAssetService;
  readonly paths: {
    readonly modelsRoot: string;
    readonly runtimeRoot: string;
    readonly meetingsRoot: string;
  };
  readonly resolveModelId: (engineId: "parakeet" | "whisper-cpp") => string;
  readonly cores: number;
  /** Filesystem seam for tests; production uses the real mkdir. */
  readonly deps?: {
    readonly mkdir?: (dir: string) => Promise<void>;
  };
}

export interface MeetingSession {
  readonly state: MeetingState;
  start: () => Promise<MeetingStartResult>;
  stop: () => Promise<void>;
  togglePause: () => boolean;
  /** Called by the capture session so dictation always wins. */
  setDictationActive: (active: boolean) => void;
  /** Meeting window -> main -> worker. Main holds nothing. */
  handleFrames: (frames: WorkerFrames) => void;
  handleArchiveChunk: (bytes: ArrayBuffer) => void;
  handleAudioState: (event: MeetingAudioStateEvent) => void;
  subscribe: (listener: (state: MeetingState) => void) => () => void;
  onSegment: (
    listener: (event: MeetingSegmentAppendedEvent) => void
  ) => () => void;
  dispose: () => void;
}

export const createMeetingSession = (options: MeetingSessionOptions): MeetingSession => {
  let state: MeetingState = INITIAL_MEETING_STATE;
  const stateListeners = new Set<(state: MeetingState) => void>();
  const segmentListeners = new Set<(event: MeetingSegmentAppendedEvent) => void>();

  let activeMeetingId: number | null = null;
  let startedAtMs: number | null = null;
  let segmentCount = 0;
  let speakerCount = 0;
  let meetingWindow: BrowserWindow | null = null;
  let laneLiveTimer: ReturnType<typeof setTimeout> | null = null;
  let windowStopTimer: ReturnType<typeof setTimeout> | null = null;
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  let lastUtteranceAtMs = 0;
  let backlogSeconds = 0;
  let meetingFailed = false;
  let disposed = false;

  const setState = (next: MeetingState): void => {
    state = next;
    for (const listener of stateListeners) {
      listener(state);
    }
  };

  const setAutoStopTimer = (): void => {
    if (autoStopTimer !== null) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }
    const minutes = options.settings().autoStopSilentMinutes;
    if (minutes > 0 && state.phase === "recording") {
      autoStopTimer = setTimeout(() => {
        if (Date.now() - lastUtteranceAtMs >= minutes * 60_000) {
          void stop();
        }
      }, minutes * 60_000);
    }
  };

  const broadcastSegment = (segment: MeetingSegment): void => {
    segmentCount += 1;
    lastUtteranceAtMs = Date.now();
    setAutoStopTimer();
    const event: MeetingSegmentAppendedEvent = {
      meetingId: segment.meetingId,
      segment,
      speakerCount
    };
    for (const listener of segmentListeners) {
      listener(event);
    }
    if (state.phase === "recording") {
      setState({ ...state, segmentCount, backlogSeconds });
    }
  };

  const handleWorkerEvent = (event: unknown): void => {
    if (disposed) return;
    const workerEvent = event as {
      readonly type: "segment" | "gap" | "heartbeat" | "failure" | "ready" | "drained";
    };
    const meetingId = activeMeetingId;
    const store = options.store;
    switch (workerEvent.type) {
      case "segment": {
        if (meetingId === null || store === null) return;
        const payload = event as {
          readonly type: "segment";
          readonly source: "system" | "microphone";
          readonly startMs: number;
          readonly endMs: number;
          readonly speakerKey: string;
          readonly text: string;
        };
        const id = store.appendSegment({
          meetingId,
          startMs: payload.startMs,
          endMs: payload.endMs,
          source: payload.source,
          speakerKey: payload.speakerKey,
          text: payload.text,
          gap: false
        });
        broadcastSegment({
          id,
          meetingId,
          startMs: payload.startMs,
          endMs: payload.endMs,
          source: payload.source,
          speakerKey: payload.speakerKey,
          text: payload.text,
          gap: false
        });
        break;
      }
      case "gap": {
        if (meetingId === null || store === null) return;
        const payload = event as {
          readonly type: "gap";
          readonly source: "system" | "microphone";
          readonly startMs: number;
          readonly endMs: number;
        };
        const id = store.appendSegment({
          meetingId,
          startMs: payload.startMs,
          endMs: payload.endMs,
          source: payload.source,
          speakerKey: "s1",
          text: "",
          gap: true
        });
        broadcastSegment({
          id,
          meetingId,
          startMs: payload.startMs,
          endMs: payload.endMs,
          source: payload.source,
          speakerKey: "s1",
          text: "",
          gap: true
        });
        break;
      }
      case "heartbeat": {
        const payload = event as {
          readonly type: "heartbeat";
          readonly queuedSeconds: number;
          readonly speakerCount: number;
        };
        backlogSeconds = payload.queuedSeconds;
        speakerCount = Math.max(speakerCount, payload.speakerCount);
        if (state.phase === "recording") {
          setState({ ...state, backlogSeconds, speakerCount });
        }
        break;
      }
      case "failure": {
        if (state.phase === "idle" || state.phase === "error") return;
        // A worker that died mid-meeting ends the meeting, and the row must
        // say interrupted, not complete.
        meetingFailed = true;
        void stop().then(() => {
          setState({ phase: "error", code: "worker-failed" });
        });
        break;
      }
      default:
        break;
    }
  };

  const start = async (): Promise<MeetingStartResult> => {
    if (isMeetingActive(state)) {
      return { ok: false, code: "already-running" };
    }
    const store = options.store;
    if (store === null) {
      return { ok: false, code: "database-unavailable" };
    }
    if (!options.assets.isReady()) {
      return { ok: false, code: "assets-missing" };
    }

    setState({ phase: "starting" });
    const settings = options.settings();
    const engine = engineId(settings);

    const meetingId = store.createMeeting({
      title: defaultTitle(new Date()),
      engineId: engine,
      modelId: options.resolveModelId(engine),
      language: null,
      audioPath: null
    });
    activeMeetingId = meetingId;
    startedAtMs = Date.now();
    segmentCount = 0;
    speakerCount = 0;
    backlogSeconds = 0;

    const meetingDir = join(options.paths.meetingsRoot, String(meetingId));
    const audioPath = settings.archiveAudio ? join(meetingDir, "recording.webm") : null;
    if (audioPath !== null) {
      store.setAudioPath(meetingId, audioPath);
    }

    try {
      await (options.deps?.mkdir ?? mkdir)(meetingDir);
      if (audioPath !== null) {
        const opened = await options.archive.open(audioPath);
        if (!opened.ok) {
          throw new Error(opened.error.message);
        }
      }
    } catch (error) {
      await abortToError(meetingId, "database-unavailable", error);
      return { ok: false, code: "database-unavailable" };
    }

    const init: WorkerInit = {
      type: "init",
      engineId: engine,
      modelsRoot: options.paths.modelsRoot,
      runtimeRoot: options.paths.runtimeRoot,
      modelId: options.resolveModelId(engine),
      assetPaths: {
        vad: options.assets.pathFor("vad") ?? "",
        embedding: options.assets.pathFor("embedding") ?? "",
        segmentation:
          settings.diarization && settings.diarizationRefineOverMs > 0
            ? options.assets.pathFor("segmentation")
            : null
      },
      numThreads: Math.max(2, Math.floor(options.cores / 2)),
      diarization: settings.diarization,
      diarizationRefineOverMs: settings.diarizationRefineOverMs,
      speakerThreshold: settings.speakerThreshold,
      maxSpeakers: settings.maxSpeakers,
      vadMinSpeechMs: settings.vadMinSpeechMs,
      vadMinSilenceMs: settings.vadMinSilenceMs,
      vadMaxSpeechMs: settings.vadMaxSpeechMs,
      speechLanguage: normalizeSpeechLanguage(options.speechLanguage())
    };
    const workerStarted = await options.worker.start(init);
    if (!workerStarted.ok) {
      await abortToError(meetingId, "engine-not-ready", new Error(workerStarted.error.message));
      return { ok: false, code: "engine-not-ready" };
    }

    try {
      meetingWindow = await options.window.create();
      await new Promise<void>((resolve, reject) => {
        const window = meetingWindow;
        if (window === null) {
          reject(new Error("No meeting window."));
          return;
        }
        window.webContents.once("did-finish-load", () => {
          resolve();
        });
        window.webContents.once("did-fail-load", (_event, code, description) => {
          reject(new Error(`Meeting window failed to load (${String(code)}): ${description}`));
        });
      });
      meetingWindow.webContents.send("meeting-audio:begin", {
        includeMicrophone: settings.includeMicrophone,
        archiveAudio: settings.archiveAudio,
        archiveBitrateKbps: settings.archiveBitrateKbps,
        microphoneDeviceId: null
      });
      // getDisplayMedia needs transient user activation and a hotkey-started
      // meeting has none. executeJavaScript with userGesture is the only
      // supported path; do not add a fallback that hopes.
      await meetingWindow.webContents.executeJavaScript(
        "window.__struqBeginMeetingAudio()",
        true
      );
    } catch (error) {
      await abortToError(meetingId, "loopback-unavailable", error);
      return { ok: false, code: "loopback-unavailable" };
    }

    laneLiveTimer = setTimeout(() => {
      // No lane went live: the loopback is unavailable (a locked desktop or
      // a refused capture). Stop and report honestly.
      if (state.phase === "starting" || state.phase === "recording") {
        void stop().then(() => {
          setState({ phase: "error", code: "loopback-unavailable" });
        });
      }
    }, LANE_LIVE_TIMEOUT_MS);

    lastUtteranceAtMs = Date.now();
    return { ok: true, meetingId };
  };

  const stop = async (): Promise<void> => {
    if (!isMeetingActive(state)) return;
    const meetingId = activeMeetingId;
    if (meetingId === null) {
      setState({ phase: "idle" });
      return;
    }
    setState({ phase: "finalizing", meetingId, remaining: backlogSeconds });

    if (laneLiveTimer !== null) {
      clearTimeout(laneLiveTimer);
      laneLiveTimer = null;
    }
    if (autoStopTimer !== null) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }

    const window = meetingWindow;
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send("meeting-audio:stop");
      await new Promise<void>((resolve) => {
        windowStopTimer = setTimeout(() => {
          windowStopTimer = null;
          resolve();
        }, WINDOW_STOP_TIMEOUT_MS);
        window.webContents.once("ipc-message", (_event, channel) => {
          if (channel === "meeting-audio:state") {
            if (windowStopTimer !== null) {
              clearTimeout(windowStopTimer);
              windowStopTimer = null;
            }
            resolve();
          }
        });
      });
    }

    let audioBytes = 0;
    if (options.archive.isOpen()) {
      audioBytes = await options.archive.close();
    }
    options.window.destroy();
    meetingWindow = null;

    await options.worker.drain(WORKER_DRAIN_TIMEOUT_MS);
    options.worker.kill();

    if (options.store !== null) {
      options.store.finalizeMeeting(meetingId, {
        endedAtMs: Date.now(),
        durationMs: Math.max(0, Date.now() - (startedAtMs ?? Date.now())),
        audioBytes,
        speakerCount,
        state: meetingFailed ? "interrupted" : "complete"
      });
    }
    activeMeetingId = null;
    startedAtMs = null;
    meetingFailed = false;
    setState({ phase: "idle" });
  };

  const togglePause = (): boolean => {
    if (state.phase !== "recording") return false;
    setState({
      phase: "paused",
      meetingId: state.meetingId,
      startedAtMs: state.startedAtMs,
      pausedAtMs: Date.now(),
      segmentCount
    });
    return true;
  };

  const setDictationActive = (active: boolean): void => {
    options.worker.setYielding(active);
  };

  const handleFrames = (frames: WorkerFrames): void => {
    options.worker.sendFrames(frames);
  };

  const handleArchiveChunk = (bytes: ArrayBuffer): void => {
    options.archive.append(bytes);
  };

  const handleAudioState = (event: MeetingAudioStateEvent): void => {
    if (state.phase !== "starting" && state.phase !== "recording") return;
    if (event.system.live || event.microphone.live) {
      if (laneLiveTimer !== null) {
        clearTimeout(laneLiveTimer);
        laneLiveTimer = null;
      }
      // The lane codes travel as strings over IPC; MeetingLaneHealth wants
      // the closed union, which the window itself is typed against.
      const laneHealth = (lane: { live: boolean; code?: string }): MeetingLaneHealth =>
        lane.code === undefined
          ? { live: lane.live }
          : { live: lane.live, code: lane.code as MeetingLaneErrorCode };
      const recording: MeetingState = {
        phase: "recording",
        meetingId: activeMeetingId ?? 0,
        startedAtMs: startedAtMs ?? Date.now(),
        system: laneHealth(event.system),
        microphone: laneHealth(event.microphone),
        backlogSeconds,
        segmentCount,
        speakerCount
      };
      setState(recording);
      setAutoStopTimer();
    } else if (event.system.code === "loopback-denied") {
      void stop().then(() => {
        setState({ phase: "error", code: "loopback-unavailable" });
      });
    }
  };

  const abortToError = async (
    meetingId: number,
    code: "database-unavailable" | "engine-not-ready" | "loopback-unavailable",
    error: unknown
  ): Promise<void> => {
    options.store?.finalizeMeeting(meetingId, {
      endedAtMs: Date.now(),
      durationMs: 0,
      audioBytes: 0,
      speakerCount: 0,
      state: "interrupted"
    });
    if (options.archive.isOpen()) {
      await options.archive.close();
    }
    options.window.destroy();
    meetingWindow = null;
    options.worker.kill();
    activeMeetingId = null;
    startedAtMs = null;
    const message = error instanceof Error ? error.message : String(error);
    void message;
    setState({ phase: "error", code });
  };

  const subscribe = (listener: (state: MeetingState) => void): (() => void) => {
    stateListeners.add(listener);
    return () => {
      stateListeners.delete(listener);
    };
  };

  const onSegment = (
    listener: (event: MeetingSegmentAppendedEvent) => void
  ): (() => void) => {
    segmentListeners.add(listener);
    return () => {
      segmentListeners.delete(listener);
    };
  };

  options.worker.onEvent(handleWorkerEvent);

  return {
    get state(): MeetingState {
      return state;
    },
    start,
    stop,
    togglePause,
    setDictationActive,
    handleFrames,
    handleArchiveChunk,
    handleAudioState,
    subscribe,
    onSegment,
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      if (laneLiveTimer !== null) clearTimeout(laneLiveTimer);
      if (windowStopTimer !== null) clearTimeout(windowStopTimer);
      if (autoStopTimer !== null) clearTimeout(autoStopTimer);
      if (activeMeetingId !== null && options.store !== null) {
        options.store.finalizeMeeting(activeMeetingId, {
          endedAtMs: Date.now(),
          durationMs: 0,
          audioBytes: 0,
          speakerCount,
          state: "interrupted"
        });
      }
      if (options.archive.isOpen()) {
        void options.archive.close();
      }
      options.window.destroy();
      meetingWindow = null;
      options.worker.kill();
      stateListeners.clear();
      segmentListeners.clear();
    }
  };
};

const engineId = (settings: MeetingSettings): "parakeet" | "whisper-cpp" =>
  settings.engineId;

const defaultTitle = (date: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `Meeting ${String(date.getFullYear())}-${month}-${day} ${hours}:${minutes}`;
};

/**
 * The dictation speech language is "auto" when the engine decides. Meetings
 * need a language the VAD and engines can rely on, so "auto" becomes null
 * (engine default), anything else passes through.
 */
const normalizeSpeechLanguage = (language: string): string | null =>
  language === "auto" ? null : language;

