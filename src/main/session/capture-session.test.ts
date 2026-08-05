import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureState } from "../../shared/capture";
import {
  DEFAULT_CAPTURE_OPTIONS,
  SIMULATED_TRANSCRIPT,
  createCaptureSession
} from "./capture-session";

const OPTIONS = { ...DEFAULT_CAPTURE_OPTIONS };

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

  it("stops into transcribing then delivering then idle", () => {
    const session = createCaptureSession(OPTIONS);
    session.start();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(500); // exceeds minCaptureMs

    session.stop();
    expect(session.state.phase).toBe("transcribing");

    vi.advanceTimersByTime(OPTIONS.simulatedInferenceMs);
    expect(session.state.phase).toBe("delivering");
    if (session.state.phase === "delivering") {
      expect(session.state.text).toBe(SIMULATED_TRANSCRIPT);
      expect(session.state.inserted).toBe(false);
    }

    vi.advanceTimersByTime(OPTIONS.deliverHoldMs);
    expect(session.state.phase).toBe("idle");
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
});
