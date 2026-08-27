import { describe, expect, it } from "vitest";
import { DEFAULT_CHUNK_PLAN, planChunks } from "./chunking";

const SAMPLE_RATE = 16_000;
const OPTIONS = { sampleRate: SAMPLE_RATE, ...DEFAULT_CHUNK_PLAN };

/** `seconds` of a loud tone, so any silent stretch stands out against it. */
const tone = (seconds: number): Int16Array => {
  const pcm = new Int16Array(Math.round(SAMPLE_RATE * seconds));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = i % 2 === 0 ? 12_000 : -12_000;
  }
  return pcm;
};

const silence = (pcm: Int16Array, fromSeconds: number, toSeconds: number): void => {
  const from = Math.round(SAMPLE_RATE * fromSeconds);
  const to = Math.round(SAMPLE_RATE * toSeconds);
  pcm.fill(0, from, to);
};

const totalSamples = (chunks: readonly { start: number; end: number }[]): number =>
  chunks.reduce((sum, chunk) => sum + (chunk.end - chunk.start), 0);

describe("chunk planner", () => {
  it("leaves a normal dictation as a single chunk", () => {
    const chunks = planChunks(tone(12), OPTIONS);
    expect(chunks).toEqual([{ start: 0, end: SAMPLE_RATE * 12 }]);
  });

  it("returns nothing for empty audio", () => {
    expect(planChunks(new Int16Array(0), OPTIONS)).toEqual([]);
  });

  it("splits a recording past the maximum", () => {
    const chunks = planChunks(tone(400), OPTIONS);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("covers every sample exactly once, with no gap and no overlap", () => {
    const pcm = tone(400);
    const chunks = planChunks(pcm, OPTIONS);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks[chunks.length - 1]?.end).toBe(pcm.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]?.start).toBe(chunks[i - 1]?.end);
    }
    expect(totalSamples(chunks)).toBe(pcm.length);
  });

  it("never emits a chunk longer than the maximum", () => {
    const maxSamples = (SAMPLE_RATE * DEFAULT_CHUNK_PLAN.maxMs) / 1000;
    for (const chunk of planChunks(tone(900), OPTIONS)) {
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(maxSamples);
    }
  });

  /**
   * The point of the planner. Cutting mid-word costs that word twice, once
   * truncated at the end of one chunk and once at the start of the next.
   */
  it("moves the cut into a pause rather than through speech", () => {
    const pcm = tone(400);
    silence(pcm, 110, 112);
    const [first] = planChunks(pcm, OPTIONS);
    expect(first?.end).toBeGreaterThan(SAMPLE_RATE * 110);
    expect(first?.end).toBeLessThan(SAMPLE_RATE * 112);
  });

  it("makes progress even when the search band collapses", () => {
    const chunks = planChunks(tone(30), {
      sampleRate: SAMPLE_RATE,
      targetMs: 1_000,
      maxMs: 10_000,
      searchMs: 60_000,
      windowMs: 5_000
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(totalSamples(chunks)).toBe(SAMPLE_RATE * 30);
  });
});
