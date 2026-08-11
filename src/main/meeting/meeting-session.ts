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
  MeetingAudioFrames,
  MeetingAudioStateEvent,
  MeetingSegmentAppendedEvent,
  MeetingSpeakersMergedEvent,
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
/**
 * A hidden window that never loads would otherwise hang start() forever with
 * the worker, the archive and the window all held open. Local file, so this
 * is generous: exceeding it means something is genuinely wrong.
 */
const WINDOW_LOAD_TIMEOUT_MS = 15_000;

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
    readonly mkdir?: (dir: string, options: { readonly recursive: true }) => Promise<unknown>;
    readonly logError?: (message: string, error: unknown) => void;
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
  handleFrames: (frames: MeetingAudioFrames) => void;
  handleArchiveChunk: (bytes: ArrayBuffer) => void;
  handleAudioState: (event: MeetingAudioStateEvent) => void;
  subscribe: (listener: (state: MeetingState) => void) => () => void;
  onSegment: (
    listener: (event: MeetingSegmentAppendedEvent) => void
  ) => () => void;
  onSpeakersMerged: (
    listener: (event: MeetingSpeakersMergedEvent) => void
  ) => () => void;
  dispose: () => void;
}

export const createMeetingSession = (options: MeetingSessionOptions): MeetingSession => {
  let state: MeetingState = INITIAL_MEETING_STATE;
  const stateListeners = new Set<(state: MeetingState) => void>();
  const segmentListeners = new Set<(event: MeetingSegmentAppendedEvent) => void>();
  const speakersMergedListeners = new Set<(event: MeetingSpeakersMergedEvent) => void>();

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
  let lastLaneHealth: { system: MeetingLaneHealth; microphone: MeetingLaneHealth } = {
    system: { live: false },
    microphone: { live: false }
  };
  const logError =
    options.deps?.logError ??
    ((message: string, error: unknown): void => {
      console.error(message, error);
    });

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
      readonly type:
        | "segment"
        | "gap"
        | "speakers-merged"
        | "heartbeat"
        | "failure"
        | "ready"
        | "drained";
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
      case "speakers-merged": {
        if (meetingId === null || store === null) return;
        const payload = event as {
          readonly type: "speakers-merged";
          readonly merges: readonly { readonly from: string; readonly into: string }[];
        };
        for (const merge of payload.merges) {
          store.mergeSpeaker(meetingId, merge.from, merge.into);
        }
        speakerCount = Math.max(1, speakerCount - payload.merges.length);
        if (state.phase === "recording") {
          setState({ ...state, speakerCount });
        }
        for (const listener of speakersMergedListeners) {
          listener({ meetingId, merges: payload.merges, speakerCount });
        }
        break;
      }
      case "heartbeat": {
        const payload = event as {
          readonly type: "heartbeat";
          readonly queuedSeconds: number;
          readonly speakerCount: number;
        };
        backlogSeconds = payload.queuedSeconds;
        // The worker's count is authoritative and can fall after a merge, so
        // this tracks it rather than ratcheting to the high-water mark.
        speakerCount = payload.speakerCount;
        if (state.phase === "recording") {
          setState({ ...state, backlogSeconds, speakerCount });
        }
        break;
      }
      case "failure": {
        if (state.phase === "idle" || state.phase === "error") return;
        if (state.phase === "starting") return;
        const payload = event as {
          readonly type: "failure";
          readonly code: string;
          readonly message: string;
        };
        logError(
          `[meeting] Worker failed during ${state.phase} (${payload.code}).`,
          new Error(payload.message)
        );
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
      await (options.deps?.mkdir ?? mkdir)(meetingDir, { recursive: true });
      if (audioPath !== null) {
        const opened = await options.archive.open(audioPath);
        if (!opened.ok) {
          throw new Error(opened.error.message);
        }
      }
    } catch (error) {
      await abortToError(meetingId, "database-unavailable", "meeting-storage", error);
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
      speakerMergeThreshold: settings.speakerMergeThreshold,
      minSpeakerAudioMs: settings.minSpeakerAudioMs,
      maxSpeakers: settings.maxSpeakers,
      vadMinSpeechMs: settings.vadMinSpeechMs,
      vadMinSilenceMs: settings.vadMinSilenceMs,
      vadMaxSpeechMs: settings.vadMaxSpeechMs,
      speechLanguage: normalizeSpeechLanguage(options.speechLanguage())
    };
    const workerStarted = await options.worker.start(init);
    if (!workerStarted.ok) {
      await abortToError(
        meetingId,
        "worker-start-failed",
        "worker-start",
        new Error(workerStarted.error.message)
      );
      return { ok: false, code: "worker-start-failed" };
    }

    try {
      meetingWindow = await options.window.create();
      await new Promise<void>((resolve, reject) => {
        const window = meetingWindow;
        if (window === null) {
          reject(new Error("No meeting window."));
          return;
        }
        // A load that neither finishes nor fails must not hang the start. The
        // listeners are `once`, so they retire themselves; the timer is the
        // only thing left to clear, and settled guards the losing path.
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("Meeting window did not load in time."));
        }, WINDOW_LOAD_TIMEOUT_MS);
        window.webContents.once("did-finish-load", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        });
        window.webContents.once("did-fail-load", (_event, code, description) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Meeting window failed to load (${String(code)}): ${description}`));
        });
      });
    } catch (error) {
      await abortToError(meetingId, "window-load-failed", "window-load", error);
      return { ok: false, code: "window-load-failed" };
    }

    try {
      meetingWindow.webContents.send("meeting-audio:begin", {
        includeMicrophone: settings.includeMicrophone,
        archiveAudio: settings.archiveAudio,
        archiveBitrateKbps: settings.archiveBitrateKbps,
        microphoneDeviceId: null
      });
      // getDisplayMedia needs transient user activation and a hotkey-started
      // meeting has none. executeJavaScript with userGesture is the only
      // supported path; do not add a fallback that hopes.
      //
      // The optional call matters: the send above and this call are separate
      // trips, so the renderer may not have run its begin handler yet. The
      // bridge is defined at renderer init for exactly that reason, and the
      // ?. keeps a first-paint race from throwing here and aborting the start.
      await meetingWindow.webContents.executeJavaScript(
        "window.__struqBeginMeetingAudio?.()",
        true
      );
    } catch (error) {
      await abortToError(meetingId, "loopback-unavailable", "audio-capture", error);
      return { ok: false, code: "loopback-unavailable" };
    }

    laneLiveTimer = setTimeout(() => {
      // No lane went live: the loopback is unavailable (a locked desktop or
      // a refused capture). Stop and report honestly.
      if (state.phase === "starting" || state.phase === "recording") {
        logError(
          "[meeting] Start failed at lane-live-timeout.",
          new Error("Neither meeting audio lane became live within 8000ms.")
        );
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
    if (state.phase === "recording") {
      if (autoStopTimer !== null) {
        clearTimeout(autoStopTimer);
        autoStopTimer = null;
      }
      signalWindowPause(true);
      setState({
        phase: "paused",
        meetingId: state.meetingId,
        startedAtMs: state.startedAtMs,
        pausedAtMs: Date.now(),
        segmentCount
      });
      return true;
    }
    if (state.phase === "paused") {
      signalWindowPause(false);
      const recording: MeetingState = {
        phase: "recording",
        meetingId: state.meetingId,
        startedAtMs: state.startedAtMs,
        system: lastLaneHealth.system,
        microphone: lastLaneHealth.microphone,
        backlogSeconds,
        segmentCount,
        speakerCount
      };
      setState(recording);
      lastUtteranceAtMs = Date.now();
      setAutoStopTimer();
      return false;
    }
    return false;
  };

  const signalWindowPause = (paused: boolean): void => {
    const window = meetingWindow;
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send("meeting-audio:pause", paused);
    }
  };

  const setDictationActive = (active: boolean): void => {
    options.worker.setYielding(active);
  };

  const handleFrames = (frames: MeetingAudioFrames): void => {
    if (state.phase === "paused") return;
    const command: WorkerFrames = {
      type: "frames",
      source: frames.source,
      pcm: frames.pcm,
      startSample: frames.startSample
    };
    options.worker.sendFrames(command);
  };

  const handleArchiveChunk = (bytes: ArrayBuffer): void => {
    options.archive.append(bytes);
  };

  const handleAudioState = (event: MeetingAudioStateEvent): void => {
    if (state.phase !== "starting" && state.phase !== "recording") return;
    if (
      state.phase === "starting" &&
      (event.system.code === "loopback-denied" ||
        event.system.code === "loopback-unavailable")
    ) {
      const code = event.system.code;
      logError(
        "[meeting] Start failed at audio-capture.",
        new Error(
          code === "loopback-denied"
            ? "System audio capture was denied."
            : "System audio capture is unavailable."
        )
      );
      void stop().then(() => {
        setState({ phase: "error", code });
      });
      return;
    }
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
      lastLaneHealth = {
        system: laneHealth(event.system),
        microphone: laneHealth(event.microphone)
      };
      const recording: MeetingState = {
        phase: "recording",
        meetingId: activeMeetingId ?? 0,
        startedAtMs: startedAtMs ?? Date.now(),
        system: lastLaneHealth.system,
        microphone: lastLaneHealth.microphone,
        backlogSeconds,
        segmentCount,
        speakerCount
      };
      setState(recording);
      setAutoStopTimer();
    }
  };

  const abortToError = async (
    meetingId: number,
    code:
      | "database-unavailable"
      | "worker-start-failed"
      | "window-load-failed"
      | "loopback-unavailable",
    step: "meeting-storage" | "worker-start" | "window-load" | "audio-capture",
    error: unknown
  ): Promise<void> => {
    logError(`[meeting] Start failed at ${step}.`, error);
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

  const onSpeakersMerged = (
    listener: (event: MeetingSpeakersMergedEvent) => void
  ): (() => void) => {
    speakersMergedListeners.add(listener);
    return () => {
      speakersMergedListeners.delete(listener);
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
    onSpeakersMerged,
    /**
     * Runs on quit, so no step may abort the ones after it.
     *
     * Killing the worker is the step that matters most and it is nearly last:
     * a database write or a window teardown that throws would otherwise leave
     * the utilityProcess running, and a surviving child both outlives the app
     * and holds files an update installer is about to replace. Each step is
     * isolated so the kill always runs.
     */
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      const step = (name: string, run: () => void): void => {
        try {
          run();
        } catch (error) {
          logError(`[meeting] dispose: ${name} failed.`, error);
        }
      };

      if (laneLiveTimer !== null) clearTimeout(laneLiveTimer);
      if (windowStopTimer !== null) clearTimeout(windowStopTimer);
      if (autoStopTimer !== null) clearTimeout(autoStopTimer);
      step("finalize the interrupted meeting", () => {
        if (activeMeetingId !== null && options.store !== null) {
          options.store.finalizeMeeting(activeMeetingId, {
            endedAtMs: Date.now(),
            durationMs: 0,
            audioBytes: 0,
            speakerCount,
            state: "interrupted"
          });
        }
      });
      step("close the archive", () => {
        if (options.archive.isOpen()) {
          void options.archive.close();
        }
      });
      step("destroy the meeting window", () => {
        options.window.destroy();
      });
      meetingWindow = null;
      step("kill the worker", () => {
        options.worker.kill();
      });
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
