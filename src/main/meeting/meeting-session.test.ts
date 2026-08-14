import { describe, expect, it, vi } from "vitest";
import { createMeetingSession } from "./meeting-session";
import type { MeetingSession, MeetingSessionOptions } from "./meeting-session";
import type { MeetingStore } from "../db/meeting-store";
import type { MeetingWorkerClient } from "./worker-client";
import type { ArchiveWriter } from "./archive-writer";
import type { MeetingAssetService } from "./assets";
import type { WorkerEvent } from "./worker/protocol";
import type { MeetingAudioStateEvent } from "../../shared/ipc";
import type { MeetingState } from "../../shared/meeting";
import type { Result } from "../../shared/result";

interface FakeStore extends MeetingStore {
  readonly created: { title: string; engineId: string; language: string | null }[];
  readonly finalized: { id: number; state: string }[];
  readonly segments: unknown[];
}

const makeStore = (): FakeStore => {
  let nextId = 1;
  const store = {
    created: [] as { title: string; engineId: string; language: string | null }[],
    finalized: [] as { id: number; state: string }[],
    segments: [] as unknown[],
    createMeeting: (input: { title: string; engineId: string; modelId: string; language: string | null; audioPath: string | null }) => {
      store.created.push({
        title: input.title,
        engineId: input.engineId,
        language: input.language
      });
      return nextId++;
    },
    appendSegment: () => 1,
    finalizeMeeting: (id: number, input: { state: "complete" | "interrupted" }) => {
      store.finalized.push({ id, state: input.state });
    },
    setTitle: () => true,
    setAudioPath: () => undefined,
    setSpeakerLabel: () => undefined,
    listMeetings: () => [],
    countMeetings: () => 0,
    getMeeting: () => null,
    listSpeakers: () => [],
    listSegments: () => [],
    countSegments: () => 0,
    searchSegments: () => [],
    removeMeeting: () => ({ removed: true, audioPath: null }),
    markInterruptedOnBoot: () => 0,
    mergeSpeaker: () => 0,
    listExpired: () => []
  };
  return store;
};

const makeWorker = (): MeetingWorkerClient & { emit: (event: WorkerEvent) => void } => {
  const listeners = new Set<(event: WorkerEvent) => void>();
  return {
    start: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    sendFrames: vi.fn(),
    setYielding: vi.fn(),
    drain: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn(),
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (event) => {
      for (const listener of listeners) {
        listener(event);
      }
    }
  };
};

const makeAssets = (ready = true): MeetingAssetService => ({
  list: () => ({ items: [], ready }),
  isReady: () => ready,
  installMissing: vi.fn().mockResolvedValue(undefined),
  pathFor: (role) => (role === "segmentation" ? "/seg.onnx" : `/asset.onnx`),
  subscribe: () => () => undefined
});

const makeArchive = (): ArchiveWriter => ({
  open: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  append: vi.fn(),
  close: vi.fn().mockResolvedValue(1024),
  isOpen: () => false,
  lastError: () => null
});

const makeWindow = () => {
  const ipcCallbacks: Array<(event: unknown, channel: string) => void> = [];
  const sent: string[] = [];
  const created = {
    webContents: {
      once: vi.fn((event: string, callback: (event: unknown, channel: string) => void) => {
        if (event === "did-finish-load") {
          setTimeout(() => {
            callback({}, "did-finish-load");
          }, 0);
        } else if (event === "ipc-message") {
          ipcCallbacks.push(callback);
        }
      }),
      send: vi.fn((channel: string) => {
        sent.push(channel);
        if (channel === "meeting-audio:stop") {
          setTimeout(() => {
            for (const callback of ipcCallbacks.splice(0)) {
              callback({}, "meeting-audio:state");
            }
          }, 0);
        }
      }),
      executeJavaScript: vi.fn().mockResolvedValue(undefined)
    },
    isDestroyed: () => false,
    sent
  };
  return { ...created, create: vi.fn().mockResolvedValue(created), destroy: vi.fn() };
};

const makeSession = (
  overrides: Partial<MeetingSessionOptions> = {}
): {
  session: MeetingSession;
  store: FakeStore;
  worker: ReturnType<typeof makeWorker>;
  window: ReturnType<typeof makeWindow>;
} => {
  const store = makeStore();
  const worker = makeWorker();
  const window = makeWindow();
  const archive = makeArchive();
  const session = createMeetingSession({
    settings: () => ({
      includeMicrophone: true,
      accelerator: "CommandOrControl+Shift+M",
      engineId: "parakeet",
      diarization: true,
      diarizationRefineOverMs: 15_000,
      speakerThreshold: 0.55,
      speakerMergeThreshold: 0.55,
      minSpeakerAudioMs: 3000,
      maxSpeakers: 0,
      archiveAudio: true,
      archiveBitrateKbps: 32,
      vadMinSpeechMs: 250,
      vadMinSilenceMs: 500,
      vadMaxSpeechMs: 20_000,
      autoStopSilentMinutes: 0,
      retentionDays: 0
    }),
    speechLanguage: () => "en",
    store,
    worker,
    window,
    archive,
    assets: makeAssets(),
    paths: {
      modelsRoot: "/models",
      runtimeRoot: "/runtimes",
      meetingsRoot: "/meetings"
    },
    resolveModelId: () => "parakeet-tdt-0.6b-v3-int8",
    cores: 8,
    deps: {
      // No real filesystem under fake timers: the fs promise would never
      // settle while the clock is frozen.
      mkdir: () => Promise.resolve(),
      logError: vi.fn()
    },
    ...overrides
  });
  return { session, store, worker, window };
};

const liveAudioState = (): MeetingAudioStateEvent => ({
  system: { live: true },
  microphone: { live: true },
  finished: false
});

describe("meeting session", () => {
  it("refuses to start twice", async () => {
    const { session } = makeSession();
    const first = await session.start();
    expect(first.ok).toBe(true);
    const second = await session.start();
    expect(second.ok).toBe(false);
    expect(second.code).toBe("already-running");
  });

  it("refuses when the database is unavailable", async () => {
    const { session } = makeSession({ store: null });
    const outcome = await session.start();
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("database-unavailable");
  });

  it("refuses when the assets are missing", async () => {
    const { session } = makeSession({ assets: makeAssets(false) });
    const outcome = await session.start();
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("assets-missing");
  });

  it("creates the meeting directory with its missing parent", async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const { session } = makeSession({ deps: { mkdir } });

    await session.start();

    expect(mkdir).toHaveBeenCalledWith(expect.stringMatching(/[\\/]meetings[\\/]1$/), {
      recursive: true
    });
  });

  it("moves through starting to recording when a lane goes live", async () => {
    const { session } = makeSession();
    const states: MeetingState[] = [];
    session.subscribe((state) => {
      states.push(state);
    });
    const outcome = await session.start();
    expect(outcome.ok).toBe(true);
    session.handleAudioState(liveAudioState());
    const recording = session.state;
    expect(recording.phase).toBe("recording");
    if (recording.phase === "recording") {
      expect(recording.system.live).toBe(true);
    }
    expect(states.some((state) => state.phase === "starting")).toBe(true);
    expect(states.some((state) => state.phase === "recording")).toBe(true);
  });

  it("reports unavailable loopback instead of starting a microphone-only meeting", async () => {
    const { session } = makeSession();
    await session.start();
    const failed = new Promise<MeetingState>((resolve) => {
      const unsubscribe = session.subscribe((state) => {
        if (state.phase === "error") {
          unsubscribe();
          resolve(state);
        }
      });
    });

    session.handleAudioState({
      system: { live: false, code: "loopback-unavailable" },
      microphone: { live: true },
      finished: false
    });

    await expect(failed).resolves.toEqual({
      phase: "error",
      code: "loopback-unavailable"
    });
  });

  it("triggers the capture gesture without depending on the begin message arriving first", async () => {
    // The begin message and the gesture call are separate trips to the
    // renderer. The renderer defines its bridge at init precisely so the
    // gesture cannot land on an undefined function, which used to throw here
    // and abort the start as loopback-unavailable, leaving a 0s meeting.
    const { session, window } = makeSession();

    const outcome = await session.start();

    expect(outcome.ok).toBe(true);
    const script = window.webContents.executeJavaScript.mock.calls[0]?.[0] as string;
    // Optional call: a renderer that has not finished wiring up must not throw.
    expect(script).toContain("__struqBeginMeetingAudio?.()");
    // And it must be sent with the user-gesture flag, or getDisplayMedia is
    // refused for want of transient activation.
    expect(window.webContents.executeJavaScript.mock.calls[0]?.[1]).toBe(true);
  });

  it("fails the start honestly when the capture gesture throws", async () => {
    const { session, window } = makeSession();
    window.webContents.executeJavaScript.mockRejectedValueOnce(new Error("no such function"));

    const outcome = await session.start();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("loopback-unavailable");
  });

  it("identifies a worker startup failure", async () => {
    const worker = makeWorker();
    const logError = vi.fn();
    vi.mocked(worker.start).mockResolvedValueOnce({
      ok: false,
      error: { code: "UNKNOWN", message: "native worker failed" }
    });
    const { session } = makeSession({
      worker,
      deps: { mkdir: () => Promise.resolve(), logError }
    });

    const outcome = await session.start();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("worker-start-failed");
    expect(session.state).toEqual({ phase: "error", code: "worker-start-failed" });
    expect(logError).toHaveBeenCalledWith(
      "[meeting] Start failed at worker-start.",
      expect.objectContaining({ message: "native worker failed" })
    );
  });

  it("identifies a meeting window load failure", async () => {
    const window = makeWindow();
    window.create.mockRejectedValueOnce(new Error("window creation failed"));
    const { session } = makeSession({ window });

    const outcome = await session.start();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("window-load-failed");
    expect(session.state).toEqual({ phase: "error", code: "window-load-failed" });
  });

  // start() awaits four times and each await is a point where the stop hotkey
  // can land. Before the generation token, the losing start rebuilt the window
  // and worker that stop had just torn down: a recorder nobody owned, holding
  // the microphone and the loopback for the life of the app.
  describe("a stop that lands mid-start", () => {
    /**
     * A start parked on the archive open, which is the first await in start().
     * `release` lets it continue so the cancellation can be observed at the
     * gate that follows.
     */
    const startParkedOnArchive = (
      overrides: Partial<MeetingSessionOptions> = {}
    ): {
      session: MeetingSession;
      store: FakeStore;
      worker: ReturnType<typeof makeWorker>;
      window: ReturnType<typeof makeWindow>;
      release: () => void;
      parked: Promise<void>;
    } => {
      const archive = makeArchive();
      let release = (): void => undefined;
      let reachedArchive = (): void => undefined;
      const parked = new Promise<void>((resolve) => {
        reachedArchive = resolve;
      });
      // Only the first open parks. A later start (the one that proves the
      // session recovers) must be free to complete on its own.
      let parkedOnce = false;
      archive.open = vi.fn(() => {
        if (parkedOnce) return Promise.resolve({ ok: true as const, value: undefined });
        parkedOnce = true;
        return new Promise<Result<void>>((resolve) => {
          reachedArchive();
          release = () => {
            resolve({ ok: true, value: undefined });
          };
        });
      });
      const made = makeSession({ archive, ...overrides });
      return { ...made, release: () => { release(); }, parked };
    };

    it("does not create the window when the stop arrives during the storage step", async () => {
      const { session, window, release, parked } = startParkedOnArchive();

      const starting = session.start();
      await parked;
      expect(session.state.phase).toBe("starting");

      const stopping = session.stop();
      release();
      const [outcome] = await Promise.all([starting, stopping]);

      expect(outcome.ok).toBe(false);
      // The cancelled start must never create the window it was about to make,
      // nor fork the worker: both would outlive the meeting with no owner.
      expect(window.create).not.toHaveBeenCalled();
      expect(session.state.phase).toBe("idle");
    });

    it("sends no begin message and leaves no phantom complete row", async () => {
      const { session, store, window, release, parked } = startParkedOnArchive();

      const starting = session.start();
      await parked;
      const stopping = session.stop();
      release();
      const [outcome] = await Promise.all([starting, stopping]);

      expect(outcome.ok).toBe(false);
      // No begin after the teardown: a cancelled start must not put a recorder
      // on the loopback.
      expect(window.sent).not.toContain("meeting-audio:begin");
      expect(window.webContents.executeJavaScript).not.toHaveBeenCalled();
      expect(session.state.phase).toBe("idle");
      // A meeting that never recorded is interrupted, never complete.
      expect(store.finalized).not.toHaveLength(0);
      expect(store.finalized.every((row) => row.state === "interrupted")).toBe(true);
    });

    it("finalizes the cancelled meeting exactly once", async () => {
      const { session, store, release, parked } = startParkedOnArchive();

      const starting = session.start();
      await parked;
      const stopping = session.stop();
      release();
      await Promise.all([starting, stopping]);

      // stop() and the unwind both know this meeting id. Two finalize writes
      // would race to decide complete versus interrupted.
      expect(store.finalized.filter((row) => row.id === 1)).toHaveLength(1);
    });

    it("refuses a second start while the first is still in flight", async () => {
      const { session, release, parked } = startParkedOnArchive();

      const first = session.start();
      await parked;
      const second = await session.start();

      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.code).toBe("already-running");

      release();
      await first;
      await session.stop();
    });

    it("kills the worker it started rather than leaking the utilityProcess", async () => {
      // Parked on the window load this time, so the worker is already forked
      // when the stop lands and the unwind has something to clean up.
      const window = makeWindow();
      let releaseLoad = (): void => undefined;
      let reachedLoad = (): void => undefined;
      const parked = new Promise<void>((resolve) => {
        reachedLoad = resolve;
      });
      window.webContents.once = vi.fn(
        (event: string, callback: (event: unknown, channel: string) => void) => {
          if (event === "did-finish-load") {
            releaseLoad = () => {
              callback({}, "did-finish-load");
            };
            reachedLoad();
          } else if (event === "ipc-message") {
            // stop() waits for the window to acknowledge; without this the
            // teardown parks on its own 5s timer and the test times out.
            setTimeout(() => {
              callback({}, "meeting-audio:state");
            }, 0);
          }
        }
      );
      const { session, worker } = makeSession({ window });

      const starting = session.start();
      await parked;
      const stopping = session.stop();
      releaseLoad();
      await Promise.all([starting, stopping]);

      expect(worker.kill).toHaveBeenCalled();
      expect(window.destroy).toHaveBeenCalled();
      expect(session.state.phase).toBe("idle");
    });

    it("accepts a fresh start once the cancelled one has unwound", async () => {
      const { session, release, parked } = startParkedOnArchive();

      const starting = session.start();
      await parked;
      const stopping = session.stop();
      release();
      await Promise.all([starting, stopping]);

      const second = await session.start();
      expect(second.ok).toBe(true);
    });
  });

  // Nothing watches the capture renderer once recording starts: the lane-live
  // timer is cleared the moment a lane goes live. Without this the session sat
  // in `recording` forever, tray and all, with an archive that stopped growing.
  describe("a capture renderer that dies mid-meeting", () => {
    it("ends the meeting instead of recording forever", async () => {
      const { session } = makeSession();
      await session.start();
      session.handleAudioState(liveAudioState());
      expect(session.state.phase).toBe("recording");

      session.handleCaptureLost("renderer crashed");
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      expect(session.state.phase).toBe("error");
      if (session.state.phase === "error") {
        expect(session.state.code).toBe("capture-lost");
      }
    });

    it("keeps what was recorded but files it interrupted", async () => {
      const { session, store } = makeSession();
      await session.start();
      session.handleAudioState(liveAudioState());

      session.handleCaptureLost("renderer crashed");
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      expect(store.finalized[0]?.state).toBe("interrupted");
    });

    it("tears the worker down rather than leaving it decoding", async () => {
      const { session, worker } = makeSession();
      await session.start();
      session.handleAudioState(liveAudioState());

      session.handleCaptureLost("renderer crashed");
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      expect(worker.kill).toHaveBeenCalled();
    });

    it("ignores a lost capture when no meeting is running", () => {
      const { session, worker } = makeSession();
      session.handleCaptureLost("renderer crashed");
      expect(session.state.phase).toBe("idle");
      expect(worker.kill).not.toHaveBeenCalled();
    });

    it("ends a paused meeting too", async () => {
      const { session } = makeSession();
      await session.start();
      session.handleAudioState(liveAudioState());
      session.togglePause();
      expect(session.state.phase).toBe("paused");

      session.handleCaptureLost("renderer crashed");
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      expect(session.state.phase).toBe("error");
    });
  });

  // The row used to record language: null while the worker decoded with the
  // real hint. A meeting transcribed under a pinned language and one that was
  // auto-detected are not equally trustworthy, so the row should say which.
  describe("the recorded language", () => {
    it("records the same hint the worker decodes with", async () => {
      const { session, store, worker } = makeSession({ speechLanguage: () => "nl" });

      await session.start();

      expect(store.created[0]?.language).toBe("nl");
      const init = vi.mocked(worker.start).mock.calls[0]?.[0];
      expect(init?.speechLanguage).toBe("nl");
    });

    it("reduces a regional tag the same way the decoder needs", async () => {
      const { session, store } = makeSession({ speechLanguage: () => "pt-BR" });
      await session.start();
      expect(store.created[0]?.language).toBe("pt");
    });

    it("records null for auto, which means the decoder detected it", async () => {
      const { session, store, worker } = makeSession({ speechLanguage: () => "auto" });

      await session.start();

      expect(store.created[0]?.language).toBeNull();
      const init = vi.mocked(worker.start).mock.calls[0]?.[0];
      expect(init?.speechLanguage).toBeNull();
    });
  });

  it("stores segments from worker events and broadcasts them", async () => {
    const { session, store, worker } = makeSession();
    const seen: unknown[] = [];
    session.onSegment((event) => {
      seen.push(event);
    });
    await session.start();
    session.handleAudioState(liveAudioState());
    worker.emit({
      type: "segment",
      source: "system",
      startMs: 1000,
      endMs: 3000,
      speakerKey: "s1",
      text: "hello there"
    });
    expect(store.segments).toHaveLength(0);
    expect(seen).toHaveLength(1);
  });

  it("finalizes the meeting on stop with the archive byte count", async () => {
    const { session, store, worker } = makeSession();
    await session.start();
    session.handleAudioState(liveAudioState());
    await session.stop();
    expect(session.state.phase).toBe("idle");
    expect(store.finalized[0]?.state).toBe("complete");
    expect(worker.drain).toHaveBeenCalled();
    expect(worker.kill).toHaveBeenCalled();
  });

  it("pauses from recording and resumes back to recording", async () => {
    const { session } = makeSession();
    await session.start();
    session.handleAudioState(liveAudioState());

    expect(session.togglePause()).toBe(true);
    expect(session.state.phase).toBe("paused");
    if (session.state.phase === "paused") {
      expect(session.state.segmentCount).toBe(0);
    }

    expect(session.togglePause()).toBe(false);
    expect(session.state.phase).toBe("recording");
  });

  it("refuses to pause outside recording", () => {
    const { session } = makeSession();
    expect(session.togglePause()).toBe(false);
    expect(session.state.phase).toBe("idle");
  });

  it("tells the window to pause the archive while paused", async () => {
    const { session, window } = makeSession();
    await session.start();
    session.handleAudioState(liveAudioState());

    session.togglePause();
    session.togglePause();
    session.togglePause();

    expect(window.sent.filter((channel) => channel === "meeting-audio:pause")).toHaveLength(3);
    expect(session.state.phase).toBe("paused");
  });

  it("stops forwarding frames to the worker while paused", async () => {
    const { session, worker } = makeSession();
    await session.start();
    session.handleAudioState(liveAudioState());
    const frames = {
      source: "system" as const,
      pcm: new ArrayBuffer(16),
      startSample: 16000,
      sampleRate: 16000
    };

    session.handleFrames(frames);
    expect(worker.sendFrames).toHaveBeenCalledTimes(1);

    session.togglePause();
    session.handleFrames(frames);
    expect(worker.sendFrames).toHaveBeenCalledTimes(1);

    session.togglePause();
    session.handleFrames(frames);
    expect(worker.sendFrames).toHaveBeenCalledTimes(2);
  });

  it("resumes forwarding frames with a fresh lane health state", async () => {
    const { session } = makeSession();
    await session.start();
    session.handleAudioState(liveAudioState());
    session.togglePause();
    session.togglePause();

    const recording = session.state;
    expect(recording.phase).toBe("recording");
    if (recording.phase === "recording") {
      expect(recording.system.live).toBe(true);
      expect(recording.microphone.live).toBe(true);
    }
  });

  it("yields the worker while dictation is active", () => {
    const { session, worker } = makeSession();
    session.setDictationActive(true);
    expect(worker.setYielding).toHaveBeenCalledWith(true);
    session.setDictationActive(false);
    expect(worker.setYielding).toHaveBeenCalledWith(false);
  });

  it("stops on a worker failure and marks the meeting interrupted", async () => {
    const { session, store, worker } = makeSession();
    await session.start();
    session.handleAudioState(liveAudioState());
    worker.emit({ type: "failure", code: "decode-failed", message: "boom" });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(session.state.phase).toBe("error");
    if (session.state.phase === "error") {
      expect(session.state.code).toBe("worker-failed");
    }
    expect(store.finalized[0]?.state).toBe("interrupted");
  });

  it("auto-stops after the silent window", async () => {
    vi.useFakeTimers();
    try {
      const { session } = makeSession({
        settings: () => ({
          includeMicrophone: true,
          accelerator: "CommandOrControl+Shift+M",
          engineId: "parakeet",
          diarization: true,
          diarizationRefineOverMs: 15_000,
          speakerThreshold: 0.55,
          speakerMergeThreshold: 0.55,
          minSpeakerAudioMs: 3000,
          maxSpeakers: 0,
          archiveAudio: true,
          archiveBitrateKbps: 32,
          vadMinSpeechMs: 250,
          vadMinSilenceMs: 500,
          vadMaxSpeechMs: 20_000,
          autoStopSilentMinutes: 1,
          retentionDays: 0
        })
      });
      const starting = session.start();
      // Let the start() microtask chain reach the did-finish-load timer
      // before the clock advances past it.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(50);
      await starting;
      session.handleAudioState(liveAudioState());
      await vi.advanceTimersByTimeAsync(60_000 + 500);
      expect(session.state.phase).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards frames to the worker without holding them", () => {
    const { session, worker } = makeSession();
    const frames = {
      source: "system" as const,
      pcm: new ArrayBuffer(16),
      startSample: 16000,
      sampleRate: 16000
    };
    session.handleFrames(frames);
    expect(worker.sendFrames).toHaveBeenCalledWith({
      type: "frames",
      source: frames.source,
      pcm: frames.pcm,
      startSample: frames.startSample
    });
  });

  // dispose runs from will-quit, including the quit that quitAndInstall
  // triggers. An exception escaping it reaches Electron as a JavaScript error
  // dialog, which on the update path replaces the install with a crash.
  describe("dispose", () => {
    it("kills the worker even when destroying the window throws", () => {
      const window = makeWindow();
      window.destroy = vi.fn(() => {
        throw new Error("Object has been destroyed");
      });
      const { session, worker } = makeSession({ window });

      expect(() => {
        session.dispose();
      }).not.toThrow();
      expect(worker.kill).toHaveBeenCalled();
    });

    it("kills the worker even when the archive refuses to close", () => {
      const archive = makeArchive();
      archive.isOpen = () => true;
      archive.close = vi.fn(() => {
        throw new Error("archive is already closed");
      });
      const { session, worker } = makeSession({ archive });

      expect(() => {
        session.dispose();
      }).not.toThrow();
      expect(worker.kill).toHaveBeenCalled();
    });

    it("still tears down when the worker itself throws on kill", () => {
      const worker = makeWorker();
      worker.kill = vi.fn(() => {
        throw new Error("child already exited");
      });
      const { session, window } = makeSession({ worker });

      expect(() => {
        session.dispose();
      }).not.toThrow();
      expect(window.destroy).toHaveBeenCalled();
    });

    it("reports each failed step rather than swallowing it", () => {
      const logError = vi.fn();
      const window = makeWindow();
      window.destroy = vi.fn(() => {
        throw new Error("Object has been destroyed");
      });
      const { session } = makeSession({
        window,
        deps: { mkdir: () => Promise.resolve(), logError }
      });

      session.dispose();
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("destroy the meeting window"),
        expect.any(Error)
      );
    });

    it("is idempotent, so a second quit signal is harmless", () => {
      const { session, worker } = makeSession();
      session.dispose();
      session.dispose();
      expect(worker.kill).toHaveBeenCalledTimes(1);
    });
  });

  it("forwards archive chunks to the writer", () => {
    const { session } = makeSession();
    const bytes = new ArrayBuffer(8);
    const archive = makeArchive();
    const { session: withWriter } = makeSession({ archive });
    withWriter.handleArchiveChunk(bytes);
    expect(archive.append).toHaveBeenCalledWith(bytes);
    void session;
  });
});
