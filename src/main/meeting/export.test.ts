import { describe, expect, it } from "vitest";
import { exportMeeting } from "./export";
import type { MeetingRecord, MeetingSegment, MeetingSpeaker } from "../../shared/meeting";

const meeting: MeetingRecord = {
  id: 1,
  title: "Weekly sync",
  startedAtMs: new Date(2026, 6, 15, 10, 0, 0).getTime(),
  endedAtMs: new Date(2026, 6, 15, 11, 5, 0).getTime(),
  durationMs: 3_900_000,
  engineId: "parakeet",
  modelId: "parakeet-tdt-0.6b-v3-int8",
  language: "en",
  audioPath: null,
  audioBytes: 0,
  speakerCount: 2,
  wordCount: 100,
  state: "complete"
};

const speakers: readonly MeetingSpeaker[] = [
  { speakerKey: "s1", label: "Sarah" },
  { speakerKey: "s2", label: "Marcus" }
];

/**
 * Five segments, two speakers, one gap, and a segment crossing the one hour
 * mark: the SRT timestamp formatter is where that breaks.
 */
const segments: readonly MeetingSegment[] = [
  { id: 1, meetingId: 1, startMs: 1_000, endMs: 8_000, source: "system", speakerKey: "s1", text: "Morning everyone", gap: false },
  { id: 2, meetingId: 1, startMs: 9_000, endMs: 15_000, source: "system", speakerKey: "s2", text: "Morning Sarah", gap: false },
  { id: 3, meetingId: 1, startMs: 16_000, endMs: 22_000, source: "system", speakerKey: "s1", text: "Let me share the numbers", gap: false },
  { id: 4, meetingId: 1, startMs: 3_700_000, endMs: 3_700_500, source: "system", speakerKey: "s2", text: "", gap: true },
  { id: 5, meetingId: 1, startMs: 3_600_000, endMs: 3_660_000, source: "microphone", speakerKey: "me", text: "Wrapping up then", gap: false }
];

describe("meeting export", () => {
  it("renders markdown with headers, speaker attribution and gap markers", () => {
    const out = exportMeeting({ meeting, segments, speakers, format: "markdown" });
    expect(out).toContain("# Weekly sync");
    expect(out).toContain("**Sarah** _(00:01)_");
    expect(out).toContain("Morning everyone");
    expect(out).toContain("**Marcus** _(00:09)_");
    expect(out).toContain("_[not transcribed]_");
    expect(out).toContain("**You** _(60:00)_");
  });

  it("renders plain text with one line per turn", () => {
    const out = exportMeeting({ meeting, segments, speakers, format: "text" });
    expect(out).toContain("[00:01] Sarah: Morning everyone");
    expect(out).toContain("[00:09] Marcus: Morning Sarah");
    expect(out).toContain("[61:40] [not transcribed]");
    expect(out).toContain("[60:00] You: Wrapping up then");
  });

  it("renders SRT cues with HH:MM:SS,mmm and skips gaps", () => {
    const out = exportMeeting({ meeting, segments, speakers, format: "srt" });
    expect(out).toContain("1\n00:00:01,000 --> 00:00:08,000\nSarah: Morning everyone");
    expect(out).toContain("2\n00:00:09,000 --> 00:00:15,000\nMarcus: Morning Sarah");
    // The one hour crossing: 3,600,000 ms is 01:00:00,000 exactly.
    expect(out).toContain("4\n01:00:00,000 --> 01:01:00,000\nYou: Wrapping up then");
    expect(out).not.toContain("not transcribed");
    // The gap is skipped, so the final cue is numbered 4, not 5.
    expect(out).not.toContain("\n5\n");
  });

  it("falls back to the default speaker label when unassigned", () => {
    const out = exportMeeting({
      meeting,
      segments: [segments[1] as MeetingSegment],
      speakers: [],
      format: "text"
    });
    expect(out).toContain("Speaker 2: Morning Sarah");
  });
});
