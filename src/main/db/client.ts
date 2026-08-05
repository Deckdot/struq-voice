/**
 * History database: better-sqlite3 with FTS5 full-text search over every
 * transcript. Native module, so it goes through the rebuild script; if the
 * module cannot load, the app degrades to no history instead of failing to
 * boot.
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { runMigrations } from "./migrations";
import { createHistoryStore, type HistoryStore } from "./history-store";

export interface DatabaseHandle {
  readonly store: HistoryStore | null;
}

export const openDatabase = (userDataPath: string): HistoryStore | null => {
  try {
    const db = new Database(join(userDataPath, "struq-voice.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return createHistoryStore(db);
  } catch (error) {
    console.warn("[db] History is unavailable. Transcription still works.", error);
    return null;
  }
};
