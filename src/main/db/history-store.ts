import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { transcripts } from "./schema";
import type { TranscriptRecord } from "../../shared/ipc";

export interface HistoryStore {
  insert: (input: Omit<TranscriptRecord, "id" | "createdAtMs">) => number;
  listRecent: (limit: number, offset?: number) => TranscriptRecord[];
  search: (query: string, limit: number) => TranscriptRecord[];
  remove: (id: number) => boolean;
  removeAll: () => void;
}

interface TranscriptRow {
  readonly id: number;
  readonly text: string;
  readonly engine_id: string;
  readonly model_id: string;
  readonly duration_ms: number;
  readonly inference_ms: number | null;
  readonly cost_usd: number | null;
  readonly language: string | null;
  readonly created_at: number;
}

const toRecord = (row: TranscriptRow): TranscriptRecord => ({
  id: row.id,
  text: row.text,
  engineId: row.engine_id,
  modelId: row.model_id,
  durationMs: row.duration_ms,
  inferenceMs: row.inference_ms ?? null,
  costUsd: row.cost_usd ?? null,
  language: row.language,
  createdAtMs: row.created_at
});

/**
 * FTS5 MATCH queries reject arbitrary syntax; quote every word so the user's
 * input can never break the query.
 */
const sanitizeFtsQuery = (query: string): string => {
  const words = query
    .split(/\s+/)
    .map((word) => word.replace(/"/g, "").trim())
    .filter((word) => word.length > 0);
  return words.map((word) => `"${word}"`).join(" ");
};

export const createHistoryStore = (db: Database.Database): HistoryStore => {
  const orm = drizzle(db);

  const insert = (input: Omit<TranscriptRecord, "id" | "createdAtMs">): number => {
    const result = orm
      .insert(transcripts)
      .values({
        text: input.text,
        engineId: input.engineId,
        modelId: input.modelId,
        durationMs: input.durationMs,
        inferenceMs: input.inferenceMs,
        costUsd: input.costUsd,
        language: input.language,
        createdAt: Date.now()
      })
      .run();
    return Number(result.lastInsertRowid);
  };

  const listRecent = (limit: number, offset = 0): TranscriptRecord[] => {
    const rows = db
      .prepare(
        `SELECT * FROM transcripts ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as unknown as TranscriptRow[];
    return rows.map(toRecord);
  };

  const search = (query: string, limit: number): TranscriptRecord[] => {
    const sanitized = sanitizeFtsQuery(query);
    if (sanitized.length === 0) return [];
    const rows = db
      .prepare(
        `SELECT * FROM transcripts WHERE id IN (
           SELECT rowid FROM transcripts_fts WHERE transcripts_fts MATCH ?
         ) ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(sanitized, limit) as unknown as TranscriptRow[];
    return rows.map(toRecord);
  };

  return {
    insert,
    listRecent,
    search,
    remove: (id: number): boolean => {
      const result = db.prepare("DELETE FROM transcripts WHERE id = ?").run(id);
      return result.changes > 0;
    },
    removeAll: () => {
      db.prepare("DELETE FROM transcripts").run();
    }
  };
};

export { transcripts };
