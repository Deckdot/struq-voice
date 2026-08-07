/**
 * History and meeting database: better-sqlite3 with FTS5 full-text search.
 * One database file, one connection, two stores over it. Native module, so
 * it goes through the rebuild script; if the module cannot load, the app
 * degrades to no history and no meeting library instead of failing to boot.
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { runMigrations } from "./migrations";
import { createHistoryStore, type HistoryStore } from "./history-store";
import { createMeetingStore, type MeetingStore } from "./meeting-store";

export interface DatabaseHandle {
  readonly history: HistoryStore | null;
  readonly meetings: MeetingStore | null;
}

export const openDatabase = (userDataPath: string): DatabaseHandle | null => {
  try {
    const db = new Database(join(userDataPath, "struq-voice.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return {
      history: createHistoryStore(db),
      meetings: createMeetingStore(db)
    };
  } catch (error) {
    console.warn("[db] History is unavailable. Transcription still works.", error);
    return null;
  }
};
