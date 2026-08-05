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
    const margin = Math.floor((SAMPLE_RATE * 120) / 1000); // 1920, capped
    expect(start).toBe(Math.max(0, 300 - margin));
    expect(end).toBe(Math.min(999, 700 + margin));
  });

  it("slices the region", () => {
    const pcm = new Int16Array([1, 2, 3, 4, 5]);
    expect(Array.from(slicePcm(pcm, 1, 3))).toEqual([2, 3, 4]);
  });
});
