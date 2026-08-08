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
  /**
   * Checkpoint the WAL and close the connection. Without this the -wal and
   * -shm files outlive the process and the next open pays a recovery pass.
   * Safe to call twice; a failure here must never block the quit.
   */
  readonly close: () => void;
}

export const openDatabase = (userDataPath: string): DatabaseHandle | null => {
  try {
    const db = new Database(join(userDataPath, "struq-voice.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return {
      history: createHistoryStore(db),
      meetings: createMeetingStore(db),
      close: () => {
        if (!db.open) return;
        try {
          db.pragma("wal_checkpoint(TRUNCATE)");
        } catch (error) {
          console.warn("[db] WAL checkpoint failed on close.", error);
        }
        try {
          db.close();
        } catch (error) {
          console.warn("[db] Close failed.", error);
        }
      }
    };
  } catch (error) {
    console.warn("[db] History is unavailable. Transcription still works.", error);
    return null;
  }
};
