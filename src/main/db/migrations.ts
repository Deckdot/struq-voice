/**
 * Versioned SQL migrations, applied in order inside a transaction each.
 * FTS5 gives real full-text search over every transcript ever dictated.
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
