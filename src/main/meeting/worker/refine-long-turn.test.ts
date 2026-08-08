import { describe, expect, it } from "vitest";
import { refineLongTurn } from "./refine-long-turn";
import type { DiarizedSubSegment } from "./refine-long-turn";

const SAMPLE_RATE = 16_000;

const makeDeps = (overrides: {
  utteranceStartSample?: number;
  samples?: Float32Array;
  subSegments?: readonly DiarizedSubSegment[];
  keys?: string[];
}) => {
  const samples =
    overrides.samples ?? new Float32Array(SAMPLE_RATE * 10).fill(0.1);
  const keys = overrides.keys ?? ["s1", "s2", "s1"];
  let assigned = 0;
  return {
    utteranceStartSample: overrides.utteranceStartSample ?? 0,
    samples,
    sampleRate: SAMPLE_RATE,
    minSubSegmentSeconds: 0.4,
    diarizer: {
      process: () => overrides.subSegments ?? []
    },
    clusterer: {
      assign: () => {
        const key = keys[assigned] ?? "s1";
        assigned += 1;
        return key;
      }
    },
    embed: (slice: Float32Array) => Float32Array.from(slice.slice(0, 8))
  };
};

describe("refineLongTurn", () => {
  it("slices sub-segments against the utterance, not the meeting", () => {
    // The utterance starts 3 seconds into the meeting. A sub-segment from
    // 0.5s to 1.5s must slice samples[8000..24000], not samples[56000..24000].
    const utteranceStartSample = SAMPLE_RATE * 3;
    const samples = new Float32Array(SAMPLE_RATE * 4);
    samples.fill(0.5, 8000, 24000);
    const deps = makeDeps({
      utteranceStartSample,
      samples,
      subSegments: [
        { start: 0.5, end: 1.5 },
        { start: 2.0, end: 2.6 }
      ],
      keys: ["s1", "s2"]
    });

    const result = refineLongTurn(deps);

    expect(result).toHaveLength(2);
    expect(result[0]?.startSample).toBe(utteranceStartSample + 8000);
    expect(result[0]?.samples.length).toBe(16_000);
    expect(result[0]?.samples[0]).toBe(0.5);
    expect(result[1]?.startSample).toBe(utteranceStartSample + 32_000);
  });

  it("merges adjacent sub-segments onto the same speaker", () => {
    const deps = makeDeps({
      subSegments: [
        { start: 0.0, end: 1.0 },
        { start: 1.0, end: 2.0 },
        { start: 2.0, end: 3.0 }
      ],
      keys: ["s1", "s1", "s1"]
    });

    const result = refineLongTurn(deps);

    expect(result).toHaveLength(1);
    expect(result[0]?.samples.length).toBe(SAMPLE_RATE * 3);
    expect(result[0]?.key).toBe("s1");
  });

  it("keeps a speaker switch as separate lines", () => {
    const deps = makeDeps({
      subSegments: [
        { start: 0.0, end: 1.0 },
        { start: 1.0, end: 2.0 }
      ],
      keys: ["s1", "s2"]
    });

    const result = refineLongTurn(deps);

    expect(result).toHaveLength(2);
    expect(result[0]?.key).toBe("s1");
    expect(result[1]?.key).toBe("s2");
  });

  it("drops sub-segments shorter than the threshold", () => {
    const deps = makeDeps({
      subSegments: [
        { start: 0.0, end: 0.2 },
        { start: 0.5, end: 1.5 }
      ],
      keys: ["s1"]
    });

    const result = refineLongTurn(deps);

    expect(result).toHaveLength(1);
    expect(result[0]?.samples.length).toBe(SAMPLE_RATE);
  });

  it("falls back to a single cluster when there are no sub-segments", () => {
    const deps = makeDeps({ subSegments: [] });
    const result = refineLongTurn(deps);
    expect(result).toHaveLength(1);
    expect(result[0]?.startSample).toBe(0);
  });

  it("falls back to s1 when diarization is unavailable", () => {
    const { diarizer: _diarizer, ...rest } = makeDeps({});
    const result = refineLongTurn({ ...rest, diarizer: null, clusterer: null });
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("s1");
  });
});
