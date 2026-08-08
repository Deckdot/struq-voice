import { describe, expect, it } from "vitest";
import { meetingMeterScale } from "./meeting-meter";

describe("meeting meter scale", () => {
  it("makes quiet speech visible without exceeding the track", () => {
    expect(meetingMeterScale(0)).toBe(0);
    expect(meetingMeterScale(0.01)).toBeCloseTo(1 / 3);
    expect(meetingMeterScale(1)).toBe(1);
    expect(meetingMeterScale(2)).toBe(1);
  });

  it("rejects invalid peaks", () => {
    expect(meetingMeterScale(Number.NaN)).toBe(0);
    expect(meetingMeterScale(-1)).toBe(0);
  });
});
