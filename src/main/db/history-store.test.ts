import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "./client";
import type { HistoryStore } from "./history-store";

/**
 * History store tests against a real temp SQLite file. The measured RTF query
 * is the only logic worth a unit test here; the FTS search and CRUD paths are
 * exercised end to end in the app.
 */

let root: string;
let store: HistoryStore;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sv-hx-"));
  const handle = openDatabase(root);
  if (handle === null) {
    throw new Error("history database failed to open in test");
  }
  const opened = handle.history;
  if (opened === null) {
    throw new Error("history database failed to open in test");
  }
  store = opened;
});

describe("history store", () => {
  it("computes measured RTF from real captures, ignoring mock", () => {
    // Mock rows must be ignored.
    store.insert({
      text: "mock one",
      engineId: "mock",
      modelId: "mock-v1",
      durationMs: 2000,
      inferenceMs: 100,
      costUsd: null,
      language: null
    });
    // Parakeet: 4s audio, 400ms inference -> 0.1 RTF.
    store.insert({
      text: "real one",
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      durationMs: 4000,
      inferenceMs: 400,
      costUsd: null,
      language: null
    });
    // Parakeet again: 8s audio, 400ms -> 0.05 RTF. Average 0.075.
    store.insert({
      text: "real two",
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      durationMs: 8000,
      inferenceMs: 400,
      costUsd: null,
      language: null
    });

    const rtf = store.measuredRtf();
    expect(rtf["mock"]).toBeUndefined();
    expect(rtf["parakeet"]).toBeCloseTo(0.075, 3);
  });
});

describe("history stats", () => {
  let statsStore: HistoryStore;

  beforeAll(() => {
    const handle = openDatabase(mkdtempSync(join(tmpdir(), "sv-stats-")));
    if (handle === null) throw new Error("history database failed to open in test");
    const opened = handle.history;
    if (opened === null) throw new Error("history database failed to open in test");
    statsStore = opened;
  });

  const add = (text: string, durationMs: number): void => {
    statsStore.insert({
      text,
      engineId: "parakeet",
      modelId: "parakeet-tdt-0.6b-v3-int8",
      durationMs,
      inferenceMs: 100,
      costUsd: null,
      language: null
    });
  };

  it("counts words and speech time, and derives words per minute", () => {
    // 5 words in 30s and 7 words in 30s: 12 words across 60s of speech.
    add("one two three four five", 30_000);
    add("six seven eight nine ten eleven twelve", 30_000);

    const stats = statsStore.stats();
    expect(stats.totalTranscripts).toBe(2);
    expect(stats.totalWords).toBe(12);
    expect(stats.totalDurationMs).toBe(60_000);
    expect(stats.todayWords).toBe(12);
    expect(stats.todayCount).toBe(2);
    expect(stats.wpm).toBe(12);
  });

  it("does not count a blank transcript as one word", () => {
    const before = statsStore.stats().totalWords;
    add("   ", 1000);
    expect(statsStore.stats().totalWords).toBe(before);
  });

  it("returns a full week of days, gaps included, oldest first", () => {
    const { daily } = statsStore.stats();
    expect(daily).toHaveLength(7);
    for (let i = 1; i < daily.length; i += 1) {
      const previous = daily[i - 1];
      const current = daily[i];
      if (previous === undefined || current === undefined) throw new Error("missing day");
      expect(current.dayStartMs).toBeGreaterThan(previous.dayStartMs);
    }
    // Everything above was inserted now, so only today carries words. Indexed
    // from the end rather than a literal, so widening the window does not
    // require editing the assertion.
    expect(daily[daily.length - 1]?.words).toBe(12);
    expect(daily[0]?.words).toBe(0);
  });

  it("counts today as a one-day streak", () => {
    expect(statsStore.stats().streakDays).toBe(1);
  });

  it("reports zeroes for an empty database rather than throwing", () => {
    const handle = openDatabase(mkdtempSync(join(tmpdir(), "sv-empty-")));
    if (handle === null) throw new Error("history database failed to open in test");
    const empty = handle.history;
    if (empty === null) throw new Error("history database failed to open in test");
    const stats = empty.stats();
    expect(stats.totalTranscripts).toBe(0);
    expect(stats.totalWords).toBe(0);
    expect(stats.wpm).toBe(0);
    expect(stats.streakDays).toBe(0);
    expect(stats.daily).toHaveLength(7);
  });
});
