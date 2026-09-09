import type Database from "better-sqlite3";

export type NoteSourceKind = "history" | "meeting";
export type NoteCreatedVia = "manual" | "quick-note" | "promotion";
export type NoteFilter = "active" | "archived" | "trash";

export interface NoteSummary {
  readonly id: number;
  readonly title: string;
  readonly preview: string;
  readonly pinnedAt: number | null;
  readonly archivedAt: number | null;
  readonly trashedAt: number | null;
  readonly updatedAt: number;
}

export interface NoteRecord extends NoteSummary {
  readonly body: string;
  readonly titleIsManual: boolean;
  readonly sourceKind: NoteSourceKind | null;
  readonly sourceId: number | null;
  readonly createdVia: NoteCreatedVia;
  readonly createdAt: number;
}

export interface NotesStore {
  list: (request: { query?: string; filter?: NoteFilter; limit?: number; offset?: number }) => { items: readonly NoteSummary[]; total: number };
  get: (id: number) => NoteRecord | null;
  create: (input: { title?: string; body?: string; createdVia?: NoteCreatedVia; sourceKind?: NoteSourceKind | null; sourceId?: number | null }) => NoteRecord | null;
  update: (id: number, input: { title?: string; body?: string; titleIsManual?: boolean }) => NoteRecord | null;
  setState: (id: number, state: NoteFilter | "active") => NoteRecord | null;
  setPinned: (id: number, pinned: boolean) => NoteRecord | null;
  duplicate: (id: number) => NoteRecord | null;
  delete: (id: number) => boolean;
  promoteHistory: (id: number) => NoteRecord | null;
  promoteMeeting: (id: number) => NoteRecord | null;
  exportMarkdown: (id: number) => string | null;
}

const now = (): number => Date.now();

const titleFromBody = (body: string): string => {
  const first = body.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  return Array.from(first.replace(/\s+/g, " ").trim()).slice(0, 80).join("");
};

export const createNotesStore = (db: Database.Database): NotesStore => {
  const row = (id: number): NoteRecord | null => {
    const result = db.prepare(`SELECT id, title, body, title_is_manual AS titleIsManual,
      source_kind AS sourceKind, source_id AS sourceId, created_via AS createdVia,
      pinned_at AS pinnedAt, archived_at AS archivedAt, trashed_at AS trashedAt,
      created_at AS createdAt, updated_at AS updatedAt
      FROM notes WHERE id = ?`).get(id) as (Omit<NoteRecord, "titleIsManual" | "preview"> & { titleIsManual: number; preview?: string }) | undefined;
    if (result === undefined) return null;
    return { ...result, titleIsManual: result.titleIsManual === 1, preview: result.body.slice(0, 180) };
  };

  const activeWhere = (filter: NoteFilter): string => {
    if (filter === "archived") return "trashed_at IS NULL AND archived_at IS NOT NULL";
    if (filter === "trash") return "trashed_at IS NOT NULL";
    return "trashed_at IS NULL AND archived_at IS NULL";
  };

  return {
    list: ({ query = "", filter = "active", limit = 50, offset = 0 }) => {
      const boundedLimit = Math.max(1, Math.min(200, limit));
      const boundedOffset = Math.max(0, offset);
      const args: (string | number)[] = [];
      let where = activeWhere(filter);
      if (query.trim().length > 0) {
        where += " AND id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)";
        args.push(query.trim().replace(/["*]/g, " "));
      }
      const items = db.prepare(`SELECT id, title, substr(body, 1, 180) AS preview,
        pinned_at AS pinnedAt, archived_at AS archivedAt, trashed_at AS trashedAt,
        updated_at AS updatedAt FROM notes WHERE ${where}
        ORDER BY CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END, updated_at DESC
        LIMIT ? OFFSET ?`).all(...args, boundedLimit, boundedOffset) as NoteSummary[];
      const count = db.prepare(`SELECT count(*) AS total FROM notes WHERE ${where}`).get(...args) as { total: number };
      return { items, total: count.total };
    },
    get: row,
    create: (input) => {
      const body = input.body?.trim() ?? "";
      const title = input.title ?? titleFromBody(body);
      if (body.length === 0 && title.trim().length === 0) return null;
      const timestamp = now();
      const result = db.prepare(`INSERT INTO notes
        (title, body, title_is_manual, source_kind, source_id, created_via, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        title,
        input.body ?? "",
        input.title !== undefined ? 1 : 0,
        input.sourceKind ?? null,
        input.sourceId ?? null,
        input.createdVia ?? "manual",
        timestamp,
        timestamp
      );
      return row(Number(result.lastInsertRowid));
    },
    update: (id, input) => {
      const current = row(id);
      if (current === null) return null;
      const body = input.body ?? current.body;
      const titleManual = input.titleIsManual ?? current.titleIsManual;
      const title = input.title ?? (titleManual ? current.title : titleFromBody(body));
      db.prepare(`UPDATE notes SET title = ?, body = ?, title_is_manual = ?, updated_at = ? WHERE id = ?`)
        .run(title, body, titleManual ? 1 : 0, now(), id);
      return row(id);
    },
    setState: (id, state) => {
      const timestamp = state === "active" ? null : now();
      if (state === "trash") {
        db.prepare("UPDATE notes SET trashed_at = ?, archived_at = NULL, updated_at = ? WHERE id = ?").run(timestamp, now(), id);
      } else if (state === "archived") {
        db.prepare("UPDATE notes SET archived_at = ?, trashed_at = NULL, updated_at = ? WHERE id = ?").run(timestamp, now(), id);
      } else {
        db.prepare("UPDATE notes SET archived_at = NULL, trashed_at = NULL, updated_at = ? WHERE id = ?").run(now(), id);
      }
      return row(id);
    },
    setPinned: (id, pinned) => {
      db.prepare("UPDATE notes SET pinned_at = ?, updated_at = ? WHERE id = ?").run(pinned ? now() : null, now(), id);
      return row(id);
    },
    duplicate: (id) => {
      const source = row(id);
      if (source === null) return null;
      return thisCreate({ title: source.title, body: source.body, createdVia: "manual" });
    },
    delete: (id) => db.prepare("DELETE FROM notes WHERE id = ? AND trashed_at IS NOT NULL").run(id).changes > 0,
    promoteHistory: (id) => {
      const existing = db.prepare("SELECT id FROM notes WHERE source_kind = 'history' AND source_id = ?").get(id) as { id: number } | undefined;
      if (existing !== undefined) return row(existing.id);
      const source = db.prepare("SELECT text FROM transcripts WHERE id = ?").get(id) as { text: string } | undefined;
      if (source === undefined) return null;
      return thisCreate({ body: source.text, createdVia: "promotion", sourceKind: "history", sourceId: id });
    },
    promoteMeeting: (id) => {
      const existing = db.prepare("SELECT id FROM notes WHERE source_kind = 'meeting' AND source_id = ?").get(id) as { id: number } | undefined;
      if (existing !== undefined) return row(existing.id);
      const meeting = db.prepare("SELECT title FROM meetings WHERE id = ?").get(id) as { title: string } | undefined;
      if (meeting === undefined) return null;
      const segments = db.prepare("SELECT speaker_key AS speakerKey, text FROM meeting_segments WHERE meeting_id = ? ORDER BY start_ms").all(id) as { speakerKey: string; text: string }[];
      const body = segments.map((segment) => `${segment.speakerKey}: ${segment.text}`).join("\n");
      return thisCreate({ title: meeting.title, body, createdVia: "promotion", sourceKind: "meeting", sourceId: id });
    },
    exportMarkdown: (id) => {
      const note = row(id);
      if (note === null) return null;
      return `# ${note.title || "Untitled note"}\n\n${note.body}`;
    }
  };

  function thisCreate(input: { title?: string; body?: string; createdVia?: NoteCreatedVia; sourceKind?: NoteSourceKind | null; sourceId?: number | null }): NoteRecord | null {
    const body = input.body ?? "";
    const title = input.title ?? titleFromBody(body);
    if (body.trim().length === 0 && title.trim().length === 0) return null;
    const timestamp = now();
    const result = db.prepare(`INSERT INTO notes (title, body, title_is_manual, source_kind, source_id, created_via, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(title, body, input.title !== undefined ? 1 : 0, input.sourceKind ?? null, input.sourceId ?? null, input.createdVia ?? "manual", timestamp, timestamp);
    return row(Number(result.lastInsertRowid));
  }
};
