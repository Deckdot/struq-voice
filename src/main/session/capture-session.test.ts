import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureState } from "../../shared/capture";
import type { PasteOutcome } from "../platform/win32/paste";
import type { CaptureAudio, CaptureAudioSource } from "./audio-source";
import {
  DEFAULT_CAPTURE_OPTIONS,
  SIMULATED_TRANSCRIPT,
  createCaptureSession,
} from "./capture-session";

const OPTIONS = { ...DEFAULT_CAPTURE_OPTIONS };

const stubSource = (overrides: Partial<CaptureAudioSource> = {}): CaptureAudioSource => ({
  beginCapture: () => {},
  endCapture: () =>
    Promise.resolve({
      pcm: new Int16Array([0, 100, 0]),
      durationMs: 100,
      sampleRate: 16_000,
    }),
  discardCapture: () => {},
  isLive: () => true,
  ...overrides,
});

describe("capture session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("idle to arming to listening on start", () => {
    const session = createCaptureSession(OPTIONS);
    const history: CaptureState[] = [];
    session.subscribe((s) => history.push(s));

    session.start();
    expect(session.state.phase).toBe("arming");

    vi.runOnlyPendingTimers();
    expect(session.state.phase).toBe("listening");
    expect(history.map((s) => s.phase)).toEqual(["arming", "listening"]);
  });

  it("ignores start while already listening", () => {
    const session = createCaptureSession(OPTIONS);
    session.start();
    vi.runOnlyPendingTimers();
    session.start();
    expect(session.state.phase).toBe("listening");
  });

  it("stops into transcribing then delivering then idle", async () => {
    const session = createCaptureSession(OPTIONS);
    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(500); // exceeds minCaptureMs

    session.stop();
    expect(session.state.phase).toBe("transcribing");

    await vi.advanceTimersByTimeAsync(OPTIONS.simulatedInferenceMs);
    expect(session.state.phase).toBe("delivering");
    if (session.state.phase === "delivering") {
      expect(session.state.text).toBe(SIMULATED_TRANSCRIPT);
      expect(session.state.inserted).toBe(false);
    }

    await vi.advanceTimersByTimeAsync(OPTIONS.deliverHoldMs);
    expect(session.state.phase).toBe("idle");
  });

  it("fires listening-end feedback before transcription starts", () => {
    const phases: string[] = [];
    const session = createCaptureSession({
      ...OPTIONS,
      onListeningEnd: () => {
        phases.push(session.state.phase);
      },
    });

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(500);
    session.stop();

    expect(phases).toEqual(["listening"]);
    expect(session.state.phase).toBe("transcribing");
  });

  it("does not fire listening-end feedback for a discarded tap", () => {
    const onListeningEnd = vi.fn();
    const session = createCaptureSession({ ...OPTIONS, onListeningEnd });

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(100);
    session.stop();

    expect(onListeningEnd).not.toHaveBeenCalled();
  });

  it("silently discards captures below minCaptureMs", () => {
    const session = createCaptureSession(OPTIONS);
    const history: CaptureState[] = [];
    session.subscribe((s) => history.push(s));

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(100); // under minCaptureMs
    session.stop();

    expect(session.state.phase).toBe("idle");
    expect(history.map((s) => s.phase)).toEqual(["arming", "listening", "idle"]);
  });

  it("discards the worklet buffer on a sub-minimum tap", () => {
    const discardCapture = vi.fn();
    const session = createCaptureSession({
      ...OPTIONS,
      source: stubSource({ discardCapture }),
    });

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(100);
    session.stop();

    expect(discardCapture).toHaveBeenCalledOnce();
  });

  it("discards the worklet buffer on cancel", () => {
    const discardCapture = vi.fn();
    const session = createCaptureSession({
      ...OPTIONS,
      source: stubSource({ discardCapture }),
    });

    session.start();
    vi.runOnlyPendingTimers();
    session.cancel();

    expect(discardCapture).toHaveBeenCalledOnce();
    expect(session.state.phase).toBe("idle");
  });

  it("a late paste result does not stamp a newer capture with the same text", async () => {
    // Two captures producing identical text: without a generation counter the
    // late result from the first would match the second's delivering state.
    const meta = {
      engineId: "mock",
      modelId: "mock",
      language: null,
      inferenceMs: 1,
      costUsd: null,
      durationMs: 100,
    };
    const pasteGate: { release: ((outcome: PasteOutcome) => void) | null } = {
      release: null,
    };
    let pasteCall = 0;
    const session = createCaptureSession({
      ...OPTIONS,
      source: stubSource(),
      transcribe: () => Promise.resolve({ text: "same words", meta }),
      deliver: () => {
        pasteCall++;
        if (pasteCall === 1) {
          return new Promise<PasteOutcome>((resolve) => {
            pasteGate.release = resolve;
          });
        }
        return Promise.resolve({ inserted: true });
      },
    });

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(500);
    session.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state.phase).toBe("delivering");

    // Return to idle, then run a second capture with the same transcript.
    await vi.advanceTimersByTimeAsync(OPTIONS.deliverHoldMs);
    expect(session.state.phase).toBe("idle");

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(500);
    session.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state.phase).toBe("delivering");
    const insertedAfterSecond =
      session.state.phase === "delivering" ? session.state.inserted : null;

    // The first capture's paste finally settles, reporting a failure.
    pasteGate.release?.({ inserted: false });
    await vi.advanceTimersByTimeAsync(0);

    const insertedNow =
      session.state.phase === "delivering" ? session.state.inserted : null;
    expect(insertedNow).toBe(insertedAfterSecond);
  });

  it("cancel during listening returns to idle with no transcript", () => {
    const session = createCaptureSession(OPTIONS);
    session.start();
    vi.runOnlyPendingTimers();
    session.cancel();
    expect(session.state.phase).toBe("idle");
  });

  it("cancel outside listening is a no-op", () => {
    const session = createCaptureSession(OPTIONS);
    session.cancel();
    expect(session.state.phase).toBe("idle");
  });

  it("fail moves to error and auto-returns to idle", () => {
    const session = createCaptureSession(OPTIONS);
    session.start();
    vi.runOnlyPendingTimers();

    session.fail("Mic disconnected. Replug the microphone and try again.");
    expect(session.state.phase).toBe("error");

    vi.advanceTimersByTime(OPTIONS.errorHoldMs);
    expect(session.state.phase).toBe("idle");
  });

  it("the maxCaptureMs watchdog force-stops a stuck capture", () => {
    const session = createCaptureSession(OPTIONS);
    session.start();
    vi.runOnlyPendingTimers();
    expect(session.state.phase).toBe("listening");

    vi.advanceTimersByTime(OPTIONS.maxCaptureMs);
    // Force-stop path: stops the capture (transcribing, then delivering).
    expect(session.state.phase).toBe("transcribing");
  });

  it("unsubscribe stops receiving updates", () => {
    const session = createCaptureSession(OPTIONS);
    const history: CaptureState[] = [];
    const unsubscribe = session.subscribe((s) => history.push(s));
    unsubscribe();

    session.start();
    expect(history).toHaveLength(0);
  });

  it("captures audio from the source and reports it before delivering", async () => {
    const audio: CaptureAudio = {
      pcm: new Int16Array([1, 2, 3]),
      durationMs: 250,
      sampleRate: 16_000,
    };
    const captured: CaptureAudio[] = [];
    const session = createCaptureSession({
      ...OPTIONS,
      source: stubSource({
        endCapture: () => Promise.resolve(audio),
        beginCapture: () => {},
      }),
      onAudio: (a) => {
        captured.push(a);
      },
    });

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(500);
    session.stop();

    await vi.advanceTimersByTimeAsync(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(audio);
    expect(session.state.phase).toBe("transcribing");
  });

  it("fails with a clear message when the source errors", async () => {
    const session = createCaptureSession({
      ...OPTIONS,
      source: stubSource({
        endCapture: () => Promise.reject(new Error("device gone")),
      }),
    });

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(500);
    session.stop();

    await vi.advanceTimersByTimeAsync(1);
    expect(session.state.phase).toBe("error");
    if (session.state.phase === "error") {
      expect(session.state.message).toContain("Microphone");
    }
  });

  it("delivers the transcript and reports the outcome as inserted", async () => {
    const deliver = vi.fn(() => Promise.resolve({ inserted: true }));
    const session = createCaptureSession({ ...OPTIONS, deliver });

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(500);
    session.stop();

    await vi.advanceTimersByTimeAsync(OPTIONS.simulatedInferenceMs);
    expect(session.state.phase).toBe("delivering");
    if (session.state.phase === "delivering") {
      expect(session.state.inserted).toBe(true);
    }
    expect(deliver).toHaveBeenCalledWith(SIMULATED_TRANSCRIPT);
  });

  it("keeps inserted false when delivery fails", async () => {
    const deliver = vi.fn(() => Promise.reject(new Error("paste failed")));
    const session = createCaptureSession({ ...OPTIONS, deliver });

    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(500);
    session.stop();

    await vi.advanceTimersByTimeAsync(OPTIONS.simulatedInferenceMs);
    expect(session.state.phase).toBe("delivering");
    if (session.state.phase === "delivering") {
      expect(session.state.inserted).toBe(false);
    }
  });
});
