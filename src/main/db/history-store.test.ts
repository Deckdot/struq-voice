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
  const opened = openDatabase(root);
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
