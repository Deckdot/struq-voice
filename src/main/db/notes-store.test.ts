import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "./client";
import type { NotesStore } from "./notes-store";

let notes: NotesStore;
let historyId: number;

beforeAll(() => {
  const handle = openDatabase(mkdtempSync(join(tmpdir(), "sv-notes-")));
  if (handle === null || handle.notes === null || handle.history === null) {
    throw new Error("notes database failed to open in test");
  }
  notes = handle.notes;
  historyId = handle.history.insert({
    text: "Buy a better microphone",
    engineId: "mock",
    modelId: "mock",
    durationMs: 1000,
    inferenceMs: 10,
    costUsd: null,
    language: "en"
  });
});

describe("notes store", () => {
  it("creates, searches and updates a note", () => {
    const created = notes.create({ body: "Plan the launch\nwith the team" });
    expect(created?.title).toBe("Plan the launch");
    const found = notes.list({ query: "launch" });
    expect(found.items.some((item) => item.id === created?.id)).toBe(true);
    const updated = notes.update(created?.id ?? -1, { body: "Plan the launch with everyone" });
    expect(updated?.title).toBe("Plan the launch with everyone");
  });

  it("promotes a history row idempotently and supports trash restore", () => {
    const first = notes.promoteHistory(historyId);
    const second = notes.promoteHistory(historyId);
    expect(first?.id).toBe(second?.id);
    const trashed = notes.setState(first?.id ?? -1, "trash");
    expect(trashed?.trashedAt).not.toBeNull();
    const restored = notes.setState(first?.id ?? -1, "active");
    expect(restored?.trashedAt).toBeNull();
  });
});
