import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "./client";
import type { MeetingStore } from "./meeting-store";

let store: MeetingStore;

beforeAll(() => {
  const handle = openDatabase(mkdtempSync(join(tmpdir(), "sv-mtg-")));
  if (handle === null) throw new Error("meeting database failed to open in test");
  const opened = handle.meetings;
  if (opened === null) throw new Error("meeting database failed to open in test");
  store = opened;
});

describe("meeting store", () => {
  it("inserts a meeting and reads it back", () => {
    const id = store.createMeeting({
      title: "Weekly sync",
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      language: "en",
      audioPath: null
    });
    const record = store.getMeeting(id);
    expect(record).not.toBeNull();
    expect(record?.title).toBe("Weekly sync");
    expect(record?.state).toBe("recording");
    expect(record?.audioBytes).toBe(0);
  });

  it("appends a segment and reads it back in timeline order", () => {
    const id = store.createMeeting({
      title: "Segment order",
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      language: null,
      audioPath: null
    });
    store.appendSegment({
      meetingId: id,
      startMs: 4000,
      endMs: 6000,
      source: "system",
      speakerKey: "s2",
      text: "later",
      gap: false
    });
    store.appendSegment({
      meetingId: id,
      startMs: 0,
      endMs: 2000,
      source: "system",
      speakerKey: "s1",
      text: "earlier",
      gap: false
    });
    const segments = store.listSegments(id, 10, 0);
    expect(segments.map((segment) => segment.text)).toEqual(["earlier", "later"]);
    expect(segments[0]?.source).toBe("system");
    expect(store.countSegments(id)).toBe(2);
  });

  it("finds a segment through FTS search", () => {
    const id = store.createMeeting({
      title: "Searchable",
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      language: null,
      audioPath: null
    });
    store.appendSegment({
      meetingId: id,
      startMs: 0,
      endMs: 1000,
      source: "system",
      speakerKey: "s1",
      text: "the quarterly roadmap review",
      gap: false
    });
    const hits = store.searchSegments("roadmap", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.segment.text).toContain("roadmap");
    expect(hits[0]?.meetingTitle).toBe("Searchable");
  });

  it("ignores a query that would break MATCH", () => {
    const hits = store.searchSegments('"unclosed', 10);
    expect(hits).toHaveLength(0);
  });

  it("deleting a meeting cascades its segments and speakers", () => {
    const id = store.createMeeting({
      title: "Cascade",
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      language: null,
      audioPath: null
    });
    store.appendSegment({
      meetingId: id,
      startMs: 0,
      endMs: 1000,
      source: "microphone",
      speakerKey: "me",
      text: "hello",
      gap: false
    });
    store.setSpeakerLabel(id, "s1", "Sarah");
    expect(store.removeMeeting(id)).toBe(true);
    expect(store.getMeeting(id)).toBeNull();
    expect(store.countSegments(id)).toBe(0);
    expect(store.listSpeakers(id)).toHaveLength(0);
  });

  it("marks only recording rows interrupted on boot", () => {
    const live = store.createMeeting({
      title: "Crashed",
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      language: null,
      audioPath: null
    });
    const done = store.createMeeting({
      title: "Finished",
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      language: null,
      audioPath: null
    });
    store.finalizeMeeting(done, {
      endedAtMs: Date.now(),
      durationMs: 1000,
      audioBytes: 0,
      speakerCount: 1,
      state: "complete"
    });
    const flipped = store.markInterruptedOnBoot();
    expect(flipped).toBeGreaterThanOrEqual(1);
    expect(store.getMeeting(live)?.state).toBe("interrupted");
    expect(store.getMeeting(done)?.state).toBe("complete");
  });

  it("computes word count at finalize", () => {
    const id = store.createMeeting({
      title: "Words",
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      language: null,
      audioPath: null
    });
    store.appendSegment({
      meetingId: id,
      startMs: 0,
      endMs: 1000,
      source: "system",
      speakerKey: "s1",
      text: "one two three",
      gap: false
    });
    store.appendSegment({
      meetingId: id,
      startMs: 1000,
      endMs: 2000,
      source: "system",
      speakerKey: "s1",
      text: "four",
      gap: false
    });
    store.finalizeMeeting(id, {
      endedAtMs: Date.now(),
      durationMs: 2000,
      audioBytes: 0,
      speakerCount: 1,
      state: "complete"
    });
    expect(store.getMeeting(id)?.wordCount).toBe(4);
  });
});
