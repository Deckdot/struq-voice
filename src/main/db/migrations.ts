/**
 * Versioned SQL migrations, applied in order inside a transaction each.
 * FTS5 gives real full-text search over every transcript ever dictated.
 * Segment text is never updated after insert, so meeting_segments has no
 * 'after update' FTS trigger; the absence is deliberate.
 */

import type Database from "better-sqlite3";

export interface Migration {
  readonly version: number;
  readonly sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        engine_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        inference_ms INTEGER,
        cost_usd REAL,
        language TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE transcripts_fts USING fts5(
        text,
        content='transcripts',
        content_rowid='id'
      );

      CREATE TRIGGER transcripts_ai AFTER INSERT ON transcripts BEGIN
        INSERT INTO transcripts_fts (rowid, text) VALUES (new.id, new.text);
      END;

      CREATE TRIGGER transcripts_ad AFTER DELETE ON transcripts BEGIN
        INSERT INTO transcripts_fts (transcripts_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
      END;
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        engine_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        language TEXT,
        audio_path TEXT,
        audio_bytes INTEGER NOT NULL DEFAULT 0,
        speaker_count INTEGER NOT NULL DEFAULT 0,
        word_count INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL
      );

      CREATE TABLE meeting_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        source TEXT NOT NULL,
        speaker_key TEXT NOT NULL,
        text TEXT NOT NULL,
        gap INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX meeting_segments_by_meeting
        ON meeting_segments (meeting_id, start_ms);

      CREATE TABLE meeting_speakers (
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker_key TEXT NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (meeting_id, speaker_key)
      );

      CREATE VIRTUAL TABLE meeting_segments_fts USING fts5(
        text,
        content='meeting_segments',
        content_rowid='id'
      );

      CREATE TRIGGER meeting_segments_ai AFTER INSERT ON meeting_segments BEGIN
        INSERT INTO meeting_segments_fts (rowid, text) VALUES (new.id, new.text);
      END;

      CREATE TRIGGER meeting_segments_ad AFTER DELETE ON meeting_segments BEGIN
        INSERT INTO meeting_segments_fts (meeting_segments_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
      END;
    `
  }
];

export const runMigrations = (db: Database.Database): void => {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
  );
  const appliedRows = db
    .prepare("SELECT version FROM schema_migrations")
    .all() as readonly { version: number }[];
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now()
      );
    })();
  }
};
