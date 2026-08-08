import { describe, expect, it } from "vitest";
import { micLevelToBar, smoothMicLevel } from "./mic-level";

/**
 * The meter previously drew linear RMS, so speech sat in the bottom few
 * percent of the bar and read as a dead microphone. These pin the response
 * that fixed it.
 */
describe("micLevelToBar", () => {
  it("reads silence as empty", () => {
    expect(micLevelToBar(0)).toBe(0);
    expect(micLevelToBar(0.0001)).toBe(0);
  });

  it("puts ordinary speech in the middle of the bar, not the floor", () => {
    // Linear RMS for speech at a normal distance. Drawn linearly this was 2%.
    expect(micLevelToBar(0.05)).toBeGreaterThan(0.4);
    expect(micLevelToBar(0.05)).toBeLessThan(0.75);
  });

  it("still leaves headroom for genuinely loud input", () => {
    expect(micLevelToBar(0.05)).toBeLessThan(micLevelToBar(0.5));
    expect(micLevelToBar(1)).toBe(1);
  });

  it("rises monotonically", () => {
    const points = [0.001, 0.01, 0.05, 0.2, 0.5, 1];
    const bars = points.map(micLevelToBar);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i] ?? 0).toBeGreaterThan(bars[i - 1] ?? 0);
    }
  });

  it("clamps out of range and non-finite input", () => {
    expect(micLevelToBar(-1)).toBe(0);
    expect(micLevelToBar(4)).toBe(1);
    expect(micLevelToBar(Number.NaN)).toBe(0);
  });
});

describe("smoothMicLevel", () => {
  it("jumps straight to a louder reading so the meter is not laggy", () => {
    expect(smoothMicLevel(0.2, 0.9)).toBe(0.9);
  });

  it("falls gradually rather than flickering on syllable gaps", () => {
    const fallen = smoothMicLevel(0.9, 0);
    expect(fallen).toBeLessThan(0.9);
    expect(fallen).toBeGreaterThan(0.5);
  });

  it("converges on a held level instead of undershooting it", () => {
    // The old smoothing multiplied the input by 0.4, so a steady input could
    // never reach the value it was given.
    let level = 0;
    for (let i = 0; i < 200; i++) level = smoothMicLevel(level, 0.6);
    expect(level).toBeCloseTo(0.6, 5);
  });

  it("settles back to silence", () => {
    let level = 1;
    for (let i = 0; i < 400; i++) level = smoothMicLevel(level, 0);
    expect(level).toBeLessThan(0.001);
  });
});
