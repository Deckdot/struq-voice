import { describe, expect, it } from "vitest";
import { buildWav, isWav, slicePcm, trimSilence, wavDurationMs } from "./wav";

const SAMPLE_RATE = 16_000;

describe("wav container", () => {
  it("builds a valid mono 16-bit PCM RIFF/WAVE file", () => {
    const pcm = new Int16Array([0, 100, 200, 100, 0]);
    const wav = buildWav(pcm, SAMPLE_RATE);

    expect(isWav(wav)).toBe(true);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.readUInt32LE(40)).toBe(pcm.byteLength);
  });

  it("round trips the duration", () => {
    const pcm = new Int16Array(SAMPLE_RATE); // exactly one second
    const wav = buildWav(pcm, SAMPLE_RATE);
    expect(wavDurationMs(wav, SAMPLE_RATE)).toBe(1000);
  });

  it("rejects non-wav bytes", () => {
    expect(isWav(Buffer.from("not a wav file"))).toBe(false);
    expect(wavDurationMs(Buffer.alloc(10), SAMPLE_RATE)).toBe(0);
  });
});

describe("silence trimming", () => {
  it("keeps silence untouched", () => {
    const pcm = new Int16Array(1000); // all zero
    expect(trimSilence(pcm, SAMPLE_RATE)).toEqual({ start: 0, end: 0 });
  });

  it("trims leading and trailing silence, keeping a margin", () => {
    const pcm = new Int16Array(1000);
    // Speech from sample 300 to sample 700.
    for (let i = 300; i <= 700; i++) {
      pcm[i] = 3000;
    }
    const { start, end } = trimSilence(pcm, SAMPLE_RATE);
    const margin = Math.floor((SAMPLE_RATE * 200) / 1000); // 3200, capped
    expect(start).toBe(Math.max(0, 300 - margin));
    expect(end).toBe(Math.min(999, 700 + margin));
  });

  it("keeps a quiet final clause a fixed threshold would have cut", () => {
    // A loud sentence, a pause, then a trailing clause at 300: under the old
    // fixed threshold of 400, so the whole ending was trimmed away and the
    // engine never saw it. This is the dropped last sentence.
    const pcm = new Int16Array(SAMPLE_RATE * 4);
    for (let i = 0; i < SAMPLE_RATE; i++) pcm[i] = 12_000;
    const quietStart = SAMPLE_RATE * 3;
    for (let i = quietStart; i < SAMPLE_RATE * 4; i++) pcm[i] = 300;

    const { end } = trimSilence(pcm, SAMPLE_RATE);

    expect(end).toBeGreaterThanOrEqual(SAMPLE_RATE * 4 - 1);
  });

  it("never trims harder than the old fixed threshold", () => {
    // A very loud clip: one percent of its peak would exceed 400, and using
    // that would start cutting speech the old behaviour kept.
    const pcm = new Int16Array(SAMPLE_RATE);
    for (let i = 0; i < SAMPLE_RATE; i++) pcm[i] = i < SAMPLE_RATE / 2 ? 32_000 : 390;

    const { end } = trimSilence(pcm, SAMPLE_RATE);

    expect(end).toBe(SAMPLE_RATE - 1);
  });

  it("still reports an all-silent buffer as empty", () => {
    const pcm = new Int16Array(SAMPLE_RATE);
    pcm.fill(20);
    expect(trimSilence(pcm, SAMPLE_RATE)).toEqual({ start: 0, end: 0 });
  });

  it("honours an explicit threshold", () => {
    const pcm = new Int16Array(1000);
    for (let i = 400; i <= 600; i++) pcm[i] = 1000;
    expect(trimSilence(pcm, SAMPLE_RATE, 5000)).toEqual({ start: 0, end: 0 });
  });

  it("slices the region", () => {
    const pcm = new Int16Array([1, 2, 3, 4, 5]);
    expect(Array.from(slicePcm(pcm, 1, 3))).toEqual([2, 3, 4]);
  });
});
