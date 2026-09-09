/**
 * Versioned SQL migrations, applied in order inside a transaction each.
 * FTS5 gives real full-text search over every transcript ever dictated.
 * Segment text is never updated after insert, so meeting_segments has no
 * 'after update' FTS trigger; the absence is deliberate.
 *
 * These are written by hand rather than generated, and that is the decision
 * rather than an omission. `schema.ts` describes the tables in Drizzle for
 * typed queries, but a generated diff needs one known database to diff
 * against. This app has one per user, each arriving from whatever version
 * they last ran and sometimes skipping several, so the only safe shape is an
 * append-only list where each version runs exactly once against whatever it
 * finds. `schema_migrations` records which have run.
 *
 * The FTS5 virtual tables and their triggers below are also outside what the
 * Drizzle SQLite dialect models, so the load-bearing half of every migration
 * would be hand-written regardless.
 *
 * Adding one: append a new version, never edit a shipped entry. An edited
 * migration silently does not re-run on a machine that already applied it.
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
  },
  {
    version: 3,
    sql: `
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        title_is_manual INTEGER NOT NULL DEFAULT 0,
        source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('history', 'meeting')),
        source_id INTEGER,
        created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'quick-note', 'promotion')),
        pinned_at INTEGER,
        archived_at INTEGER,
        trashed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX notes_source_unique ON notes(source_kind, source_id)
        WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;
      CREATE INDEX notes_updated ON notes(updated_at DESC);

      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title, body, content='notes', content_rowid='id'
      );

      CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
      END;
      CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body)
          VALUES ('delete', old.id, old.title, old.body);
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
      END;
      CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body)
          VALUES ('delete', old.id, old.title, old.body);
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
