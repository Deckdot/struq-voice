import { describe, expect, it } from "vitest";
import { defaultSpeakerLabel, isMeetingActive } from "./meeting";
import type { MeetingState } from "./meeting";

describe("isMeetingActive", () => {
  it("is false when idle", () => {
    expect(isMeetingActive({ phase: "idle" })).toBe(false);
  });

  it("is false when errored", () => {
    expect(isMeetingActive({ phase: "error", code: "worker-failed" })).toBe(false);
  });

  it("is true while starting", () => {
    expect(isMeetingActive({ phase: "starting" })).toBe(true);
  });

  it("is true while recording", () => {
    const recording: MeetingState = {
      phase: "recording",
      meetingId: 1,
      startedAtMs: 1000,
      system: { live: true },
      microphone: { live: true },
      backlogSeconds: 0,
      segmentCount: 3,
      speakerCount: 2
    };
    expect(isMeetingActive(recording)).toBe(true);
  });

  it("is true while paused", () => {
    const paused: MeetingState = {
      phase: "paused",
      meetingId: 1,
      startedAtMs: 1000,
      pausedAtMs: 2000,
      segmentCount: 3
    };
    expect(isMeetingActive(paused)).toBe(true);
  });

  it("is true while finalizing", () => {
    expect(isMeetingActive({ phase: "finalizing", meetingId: 1, remaining: 2 })).toBe(true);
  });
});

describe("defaultSpeakerLabel", () => {
  it("names the microphone lane", () => {
    expect(defaultSpeakerLabel("me")).toBe("You");
  });

  it("numbers system speakers in first-heard order", () => {
    expect(defaultSpeakerLabel("s1")).toBe("Speaker 1");
    expect(defaultSpeakerLabel("s12")).toBe("Speaker 12");
  });
});
