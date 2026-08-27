import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterEngine } from "./openrouter";

/**
 * The cloud engine used to refuse anything over sixty seconds outright. That
 * limit was ours, not the provider's: the endpoint caps the size of one
 * request, not the length of a dictation. These tests pin the replacement,
 * which cuts a long recording at its own pauses and sends it as several
 * requests.
 */

const SAMPLE_RATE = 16_000;

const speech = (seconds: number): Int16Array => {
  const pcm = new Int16Array(SAMPLE_RATE * seconds);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = i % 2 === 0 ? 9_000 : -9_000;
  }
  return pcm;
};

const engine = createOpenRouterEngine({
  getApiKey: () => Promise.resolve("sk-or-v1-test")
});

const request = (
  pcm: Int16Array,
  signal: AbortSignal = new AbortController().signal
): { pcm: Int16Array; durationMs: number; signal: AbortSignal } => ({
  pcm,
  durationMs: Math.round((pcm.length / SAMPLE_RATE) * 1000),
  signal
});

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openrouter engine", () => {
  it("sends a short capture as one request", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: "hello there" }));

    const outcome = await engine.transcribe(request(speech(4)));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.text).toBe("hello there");
  });

  it("accepts a five minute recording instead of refusing it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: "part" }));

    const outcome = await engine.transcribe(request(speech(300)));

    expect(outcome.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("joins the chunk transcripts back into one and sums the cost", async () => {
    let call = 0;
    fetchMock.mockImplementation(() => {
      call += 1;
      return Promise.resolve(
        jsonResponse({ text: `chunk ${String(call)}`, usage: { cost: 0.01 } })
      );
    });

    const outcome = await engine.transcribe(request(speech(300)));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.text).toBe(
      Array.from({ length: call }, (_, i) => `chunk ${String(i + 1)}`).join(" ")
    );
    expect(outcome.value.costUsd).toBeCloseTo(0.01 * call, 6);
  });

  /**
   * The whole point of the change. Losing the last chunk of a five minute
   * dictation used to lose all five minutes.
   */
  it("keeps the chunks that succeeded when a later one fails", async () => {
    let call = 0;
    fetchMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve(jsonResponse({ text: "the first part" }));
      return Promise.reject(new Error("socket hang up"));
    });

    const outcome = await engine.transcribe(request(speech(300)));

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.text).toBe("the first part");
  });

  it("reports a failure only when nothing at all came back", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    const outcome = await engine.transcribe(request(speech(300)));

    expect(outcome.ok).toBe(false);
  });

  it("retries a retryable status on the smaller model", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: "rate limited" } }, 429))
      .mockResolvedValueOnce(jsonResponse({ text: "recovered" }));

    const outcome = await engine.transcribe(request(speech(4)));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.modelId).toBe("openai/whisper-1");
  });

  it("stops sending chunks once the request is aborted", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(jsonResponse({ text: "first" }));
    });

    const outcome = await engine.transcribe(request(speech(300), controller.signal));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.text).toBe("first");
  });

  it("reports not ready without an API key", async () => {
    const keyless = createOpenRouterEngine({ getApiKey: () => Promise.resolve(null) });
    await expect(keyless.readiness()).resolves.toMatchObject({
      ready: false,
      action: "set-api-key"
    });
  });
});
