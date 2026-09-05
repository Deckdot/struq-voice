import { describe, expect, it } from "vitest";
import { defaultSpeakerLabel, isMeetingActive } from "./meeting";
import type { MeetingState } from "./meeting";

describe("isMeetingActive", () => {
  it("includes every live phase and excludes terminal phases", () => {
    expect(isMeetingActive({ phase: "idle" })).toBe(false);
    expect(isMeetingActive({ phase: "error", code: "worker-failed" })).toBe(false);
    expect(isMeetingActive({ phase: "starting" })).toBe(true);

    const recording: MeetingState = {
      phase: "recording",
      meetingId: 1,
      startedAtMs: 1000,
      system: { live: true },
      microphone: { live: true },
      transcriber: { engineId: "whisper-cpp", modelId: "whisper-large-v3-turbo-q5_0", kind: "local" },
      backlogSeconds: 0,
      segmentCount: 3,
      speakerCount: 2
    };
    expect(isMeetingActive(recording)).toBe(true);

    const paused: MeetingState = {
      phase: "paused",
      meetingId: 1,
      startedAtMs: 1000,
      pausedAtMs: 2000,
      segmentCount: 3,
      transcriber: { engineId: "whisper-cpp", modelId: "whisper-large-v3-turbo-q5_0", kind: "local" }
    };
    expect(isMeetingActive(paused)).toBe(true);
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
