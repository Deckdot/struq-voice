import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPartialTranscriber } from "./partial-transcriber";
import type { PartialTranscriberOptions } from "./partial-transcriber";
import type { CaptureAudio } from "./audio-source";
import type { TranscribeResult } from "../engines/types";
import type { Result } from "../../shared/result";

const audio = (durationMs: number): CaptureAudio => ({
  pcm: new Int16Array(Math.max(1, Math.round((durationMs / 1000) * 16000))),
  durationMs,
  sampleRate: 16000
});

const ok = (text: string): Result<TranscribeResult> => ({
  ok: true,
  value: {
    text,
    language: "en",
    engineId: "mock",
    modelId: "mock",
    inferenceMs: 1,
    realtimeFactor: 0.1,
    costUsd: null
  }
});

interface Harness {
  readonly partials: { text: string; durationMs: number; sequence: number }[];
  readonly options: PartialTranscriberOptions;
}

const harness = (overrides: Partial<PartialTranscriberOptions> = {}): Harness => {
  const partials: { text: string; durationMs: number; sequence: number }[] = [];
  const options: PartialTranscriberOptions = {
    intervalMs: 1000,
    snapshotTimeoutMs: 500,
    minAudioMs: 300,
    snapshot: () => Promise.resolve(audio(1000)),
    transcribe: () => Promise.resolve(ok("hello there")),
    onPartial: (partial) => partials.push(partial),
    ...overrides
  };
  return { partials, options };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createPartialTranscriber", () => {
  it("does nothing until started", async () => {
    const { partials, options } = harness();
    createPartialTranscriber(options);
    await vi.advanceTimersByTimeAsync(5000);
    expect(partials).toHaveLength(0);
  });

  it("emits a partial on each interval tick", async () => {
    const { partials, options } = harness();
    const driver = createPartialTranscriber(options);
    driver.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(partials).toHaveLength(1);
    expect(partials[0]?.text).toBe("hello there");

    await vi.advanceTimersByTimeAsync(1000);
    expect(partials).toHaveLength(2);
  });

  it("numbers partials in order from 1 within a capture", async () => {
    const { partials, options } = harness();
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(partials.map((p) => p.sequence)).toEqual([1, 2, 3]);
  });

  it("restarts numbering for a new capture", async () => {
    const { partials, options } = harness();
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(1000);
    driver.stop();
    driver.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(partials.map((p) => p.sequence)).toEqual([1, 1]);
  });

  it("skips a tick while the previous decode is still running", async () => {
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const { partials, options } = harness({
      transcribe: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        active -= 1;
        return ok("slow");
      }
    });
    const driver = createPartialTranscriber(options);
    driver.start();

    // Three ticks pass while the first decode is still in flight.
    await vi.advanceTimersByTimeAsync(3000);
    expect(peak).toBe(1);
    expect(partials).toHaveLength(0);

    expect(releases).toHaveLength(1);
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(partials).toHaveLength(1);
  });

  it("stops emitting once the capture ends", async () => {
    const { partials, options } = harness();
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(partials).toHaveLength(1);

    driver.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(partials).toHaveLength(1);
  });

  it("drops a decode that lands after the capture ended", async () => {
    const releases: (() => void)[] = [];
    const { partials, options } = harness({
      transcribe: async () => {
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return ok("too late");
      }
    });
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(1000);

    driver.stop();
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(10);

    expect(partials).toHaveLength(0);
  });

  it("aborts the in-flight decode when the capture ends", async () => {
    const seen: AbortSignal[] = [];
    const { options } = harness({
      transcribe: (_audio, signal) => {
        seen.push(signal);
        return new Promise(() => {
          // Never resolves: the abort is what must happen.
        });
      }
    });
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.aborted).toBe(false);

    driver.stop();
    expect(seen[0]?.aborted).toBe(true);
  });

  it("skips audio shorter than minAudioMs", async () => {
    const { partials, options } = harness({
      snapshot: () => Promise.resolve(audio(100))
    });
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(partials).toHaveLength(0);
  });

  it("skips a pass when no snapshot comes back", async () => {
    const { partials, options } = harness({
      snapshot: () => Promise.resolve(null)
    });
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(partials).toHaveLength(0);
  });

  it("swallows a failed decode and keeps going", async () => {
    let call = 0;
    const { partials, options } = harness({
      transcribe: () => {
        call += 1;
        if (call === 1) return Promise.reject(new Error("engine exploded"));
        return Promise.resolve(ok("recovered"));
      }
    });
    const driver = createPartialTranscriber(options);
    driver.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(partials).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(partials).toHaveLength(1);
    expect(partials[0]?.text).toBe("recovered");
  });

  it("ignores an engine result that is not ok", async () => {
    const { partials, options } = harness({
      transcribe: () =>
        Promise.resolve<Result<TranscribeResult>>({
          ok: false,
          error: { code: "APP_NOT_READY", message: "not ready" }
        })
    });
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(partials).toHaveLength(0);
  });

  it("ignores an empty transcript", async () => {
    const { partials, options } = harness({
      transcribe: () => Promise.resolve(ok("   "))
    });
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(partials).toHaveLength(0);
  });

  it("drops a decode aborted mid-flight while the same capture is still open", async () => {
    // The abort guard, isolated: captureId is unchanged here, so only the
    // signal check can reject this result. A capture that is stopped and
    // immediately restarted must not show the abandoned decode's text.
    const releases: (() => void)[] = [];
    const signals: AbortSignal[] = [];
    const { partials, options } = harness({
      transcribe: async (_audio, signal) => {
        signals.push(signal);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return ok("abandoned");
      }
    });
    const driver = createPartialTranscriber(options);
    driver.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(signals).toHaveLength(1);

    // Abort without advancing captureId past what the pass captured.
    signals[0]?.dispatchEvent(new Event("abort"));
    Object.defineProperty(signals[0], "aborted", { value: true, configurable: true });

    releases[0]?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(partials).toHaveLength(0);
  });

  it("reports whether a capture is open", async () => {
    const { options } = harness();
    const driver = createPartialTranscriber(options);
    expect(driver.isRunning()).toBe(false);
    driver.start();
    expect(driver.isRunning()).toBe(true);
    driver.stop();
    expect(driver.isRunning()).toBe(false);
    await Promise.resolve();
  });
});
