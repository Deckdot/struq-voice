import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { transcripts } from "./schema";
import { HISTORY_ACTIVITY_DAYS } from "../../shared/ipc";
import type { HistoryStatsDay, HistoryStatsResult, TranscriptRecord } from "../../shared/ipc";

export interface HistoryStore {
  insert: (input: Omit<TranscriptRecord, "id" | "createdAtMs">) => number;
  listRecent: (limit: number, offset?: number) => TranscriptRecord[];
  search: (query: string, limit: number) => TranscriptRecord[];
  remove: (id: number) => boolean;
  removeAll: () => void;
  /** Measured realtime factor per engine id, from real captures. */
  measuredRtf: () => Record<string, number>;
  /** Dashboard aggregates. Counted in SQL, never by pulling rows. */
  stats: () => HistoryStatsResult;
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

const DAY_MS = 86_400_000;

interface DayTotals {
  readonly words: number;
  readonly ms: number;
}

/**
 * SQLite has no split, so words are counted as separators plus one. Dictated
 * text is single-spaced, which is what makes this exact in practice; runs of
 * whitespace would each count as an extra word. Guarded by NON_EMPTY so a
 * blank transcript cannot report itself as one word. Exported because the
 * meeting store counts words over its own segments with the same expression.
 */
export const WORD_COUNT = `(length(trim(text)) - length(replace(trim(text), ' ', '')) + 1)`;
const NON_EMPTY = `length(trim(text)) > 0`;

/** The local-time YYYY-MM-DD that SQLite's 'localtime' modifier produces. */
const localDayKey = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
};

/**
 * FTS5 MATCH queries reject arbitrary syntax; quote every word so the user's
 * input can never break the query. Exported because the meeting store must
 * sanitize its own search the same way; duplicating the reasoning in two
 * places invites one of them to drift.
 */
export const sanitizeFtsQuery = (query: string): string => {
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

  const measuredRtf = (): Record<string, number> => {
    const rows = db
      .prepare(
        `SELECT engine_id, inference_ms, duration_ms FROM transcripts
         WHERE engine_id != 'mock' AND inference_ms IS NOT NULL AND duration_ms > 0
         ORDER BY created_at DESC, id DESC LIMIT 200`
      )
      .all() as unknown as Array<{
      engine_id: string;
      inference_ms: number;
      duration_ms: number;
    }>;
    const sums = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      const entry = sums.get(row.engine_id) ?? { total: 0, count: 0 };
      entry.total += row.inference_ms / row.duration_ms;
      entry.count += 1;
      sums.set(row.engine_id, entry);
    }
    const result: Record<string, number> = {};
    for (const [engineId, entry] of sums) {
      result[engineId] = entry.total / entry.count;
    }
    return result;
  };

  const stats = (): HistoryStatsResult => {
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(${WORD_COUNT}), 0) AS words,
                COALESCE(SUM(duration_ms), 0) AS ms
         FROM transcripts WHERE ${NON_EMPTY}`
      )
      .get() as DayTotals & { n: number };

    const today = db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(${WORD_COUNT}), 0) AS words,
                COALESCE(SUM(duration_ms), 0) AS ms
         FROM transcripts
         WHERE ${NON_EMPTY}
           AND date(created_at / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')`
      )
      .get() as DayTotals & { n: number };

    // Speed is only meaningful over recent behaviour: a faster or slower
    // speaking style from a year ago should not drag today's number.
    const cutoff = Date.now() - 30 * DAY_MS;
    const recent = db
      .prepare(
        `SELECT COALESCE(SUM(${WORD_COUNT}), 0) AS words,
                COALESCE(SUM(duration_ms), 0) AS ms
         FROM transcripts WHERE ${NON_EMPTY} AND created_at >= ?`
      )
      .get(cutoff) as DayTotals;

    const grouped = db
      .prepare(
        `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
                COALESCE(SUM(${WORD_COUNT}), 0) AS words,
                COALESCE(SUM(duration_ms), 0) AS ms
         FROM transcripts WHERE ${NON_EMPTY}
         GROUP BY day ORDER BY day DESC LIMIT 400`
      )
      .all() as Array<DayTotals & { day: string }>;

    const byDay = new Map<string, DayTotals>();
    for (const row of grouped) {
      byDay.set(row.day, { words: row.words, ms: row.ms });
    }

    // Gaps are filled here rather than with a recursive CTE: a day with no
    // dictation must still occupy a slot, otherwise the sparkline lies about
    // the shape of a fortnight.
    const daily: HistoryStatsDay[] = [];
    const now = new Date();
    for (let back = HISTORY_ACTIVITY_DAYS - 1; back >= 0; back -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
      const entry = byDay.get(localDayKey(date));
      daily.push({
        dayStartMs: date.getTime(),
        words: entry?.words ?? 0,
        durationMs: entry?.ms ?? 0
      });
    }

    let streakDays = 0;
    for (let back = 0; back < grouped.length + 1; back += 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
      if (!byDay.has(localDayKey(date))) {
        // Today not yet dictated in does not break a streak earned yesterday.
        if (back === 0) continue;
        break;
      }
      streakDays += 1;
    }

    return {
      todayWords: today.words,
      todayDurationMs: today.ms,
      todayCount: today.n,
      wpm: recent.ms > 0 ? Math.round(recent.words / (recent.ms / 60_000)) : 0,
      streakDays,
      totalTranscripts: totals.n,
      totalWords: totals.words,
      totalDurationMs: totals.ms,
      daily
    };
  };

  return {
    insert,
    listRecent,
    search,
    measuredRtf,
    stats,
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
