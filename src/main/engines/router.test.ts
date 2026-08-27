import { afterEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../shared/result";
import { ok } from "../../shared/result";
import type { TranscribeRequest, TranscriptionEngine } from "./types";
import { createEngineRouter, type EngineRouter } from "./router";

const makeEngine = (
  id: string,
  kind: "local" | "cloud",
  behavior: "ok" | "not-ready" | "error"
): TranscriptionEngine => ({
  id,
  displayName: id,
  kind,
  readiness: () =>
    Promise.resolve(
      behavior === "not-ready"
        ? { ready: false, reason: `${id} not ready` }
        : { ready: true }
    ),
  warmup: () => Promise.resolve(),
  transcribe: () => {
    if (behavior === "error") {
      return Promise.reject(new Error(`${id} crashed`));
    }
    return Promise.resolve(
      ok({
        text: `text from ${id}`,
        language: null,
        engineId: id,
        modelId: `${id}-model`,
        inferenceMs: 1,
        realtimeFactor: 0.01,
        costUsd: null
      })
    );
  },
  dispose: () => Promise.resolve()
});

const request = (): Omit<TranscribeRequest, "signal"> => ({
  pcm: new Int16Array([0, 1]),
  durationMs: 100
});

const setup = (
  engines: TranscriptionEngine[],
  cloudFallbackOptIn = false
): EngineRouter =>
  createEngineRouter({
    getEngine: (id) => engines.find((engine) => engine.id === id),
    cloudFallbackOptIn: () => cloudFallbackOptIn
  });

const isOk = <T>(result: Result<T>): result is { ok: true; value: T } => result.ok;

describe("engine router", () => {
  it("uses the primary engine when it succeeds", async () => {
    const router = setup([makeEngine("a", "local", "ok")]);
    const result = await router.transcribe(request(), "a", null);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.result.text).toBe("text from a");
      expect(result.value.fallbackUsed).toBe(false);
    }
  });

  it("fails clearly when the primary engine is missing", async () => {
    const router = setup([]);
    const result = await router.transcribe(request(), "missing", null);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.error.message).toContain("missing");
  });

  it("cascades to the fallback on a not-ready primary", async () => {
    const router = setup([
      makeEngine("a", "local", "not-ready"),
      makeEngine("b", "local", "ok")
    ]);
    const result = await router.transcribe(request(), "a", "b");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.result.text).toBe("text from b");
      expect(result.value.fallbackUsed).toBe(true);
    }
  });

  it("cascades to the fallback on a primary error", async () => {
    const router = setup([
      makeEngine("a", "local", "error"),
      makeEngine("b", "local", "ok")
    ]);
    const result = await router.transcribe(request(), "a", "b");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.result.text).toBe("text from b");
    }
  });

  it("refuses local to cloud cascade without opt-in", async () => {
    const router = setup([makeEngine("a", "local", "error"), makeEngine("b", "cloud", "ok")]);
    const result = await router.transcribe(request(), "a", "b");
    expect(isOk(result)).toBe(false);
  });

  it("allows local to cloud cascade with explicit opt-in", async () => {
    const router = setup(
      [makeEngine("a", "local", "error"), makeEngine("b", "cloud", "ok")],
      true
    );
    const result = await router.transcribe(request(), "a", "b");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.result.text).toBe("text from b");
    }
  });

  it("allows cloud to anything cascade", async () => {
    const router = setup([makeEngine("a", "cloud", "error"), makeEngine("b", "local", "ok")]);
    const result = await router.transcribe(request(), "a", "b");
    expect(isOk(result)).toBe(true);
  });

  /**
   * The regression that lost five minute dictations. The local budget was a
   * fixed 20 seconds whatever the recording's length, so a decode that was
   * merely long was aborted as if it had hung, and the transcript was gone.
   */
  describe("budgets scale with the length of the recording", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const slowEngine = (decodeMs: number): TranscriptionEngine => ({
      ...makeEngine("slow", "local", "ok"),
      transcribe: (req: TranscribeRequest) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(
              ok({
                text: "the whole five minutes",
                language: null,
                engineId: "slow",
                modelId: "slow-model",
                inferenceMs: decodeMs,
                realtimeFactor: 0.1,
                costUsd: null
              })
            );
          }, decodeMs);
          req.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        })
    });

    const runWith = async (durationMs: number, decodeMs: number) => {
      vi.useFakeTimers();
      const engine = slowEngine(decodeMs);
      const router = createEngineRouter({
        getEngine: () => engine,
        cloudFallbackOptIn: () => false
      });
      const pending = router.transcribe(
        { pcm: new Int16Array(8), durationMs },
        "slow",
        null
      );
      await vi.advanceTimersByTimeAsync(decodeMs + 1_000);
      return pending;
    };

    it("lets a five minute capture decode for well past the old 20 seconds", async () => {
      const result = await runWith(300_000, 90_000);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.result.text).toBe("the whole five minutes");
      }
    });

    it("still gives up on an engine that is genuinely stuck", async () => {
      const result = await runWith(300_000, 60 * 60_000);
      expect(isOk(result)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("TIMEOUT");
    });
  });

  it("enforces the timeout by aborting the engine request", async () => {
    const engine: TranscriptionEngine = {
      ...makeEngine("slow", "cloud", "ok"),
      transcribe: async (req) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(req.signal.aborted).toBe(true);
        throw new Error("aborted");
      }
    };
    const router = createEngineRouter({
      getEngine: (id) => engines.get(id),
      cloudFallbackOptIn: () => false,
      cloudTimeoutMs: 10
    });
    const engines = new Map([["slow", engine]]);
    const result = await router.transcribe(request(), "slow", null);
    expect(isOk(result)).toBe(false);
  });
});
