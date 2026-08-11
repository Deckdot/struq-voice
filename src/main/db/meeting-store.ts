import type Database from "better-sqlite3";
import type { MeetingSearchHit } from "../../shared/ipc";
import type {
  MeetingRecord,
  MeetingSegment,
  MeetingSpeaker
} from "../../shared/meeting";
import { sanitizeFtsQuery, WORD_COUNT } from "./history-store";

/**
 * The only writer of meeting rows. One connection, one writer, no WAL
 * contention: the worker posts finished segments to main and never touches
 * the database itself.
 */

export interface MeetingStore {
  createMeeting: (input: {
    title: string;
    engineId: string;
    modelId: string;
    language: string | null;
    audioPath: string | null;
  }) => number;
  appendSegment: (input: Omit<MeetingSegment, "id">) => number;
  finalizeMeeting: (id: number, input: {
    endedAtMs: number;
    durationMs: number;
    audioBytes: number;
    speakerCount: number;
    state: "complete" | "interrupted";
  }) => void;
  setTitle: (id: number, title: string) => boolean;
  setAudioPath: (id: number, audioPath: string) => void;
  setSpeakerLabel: (id: number, speakerKey: string, label: string) => void;
  /**
   * Relabels every segment already written under `from` to `into`, for when
   * the clustering discovers two speakers were one voice. Returns the number
   * of segments moved.
   */
  mergeSpeaker: (id: number, from: string, into: string) => number;
  listMeetings: (limit: number, offset: number) => MeetingRecord[];
  countMeetings: () => number;
  getMeeting: (id: number) => MeetingRecord | null;
  listSpeakers: (id: number) => MeetingSpeaker[];
  listSegments: (id: number, limit: number, offset: number) => MeetingSegment[];
  countSegments: (id: number) => number;
  searchSegments: (query: string, limit: number) => MeetingSearchHit[];
  removeMeeting: (id: number) => boolean;
  /** Meetings still marked recording after a crash. Called once at boot. */
  markInterruptedOnBoot: () => number;
  /** Ids and audio paths older than the cutoff, for the retention sweep. */
  listExpired: (cutoffMs: number) => { id: number; audioPath: string | null }[];
}

interface MeetingRow {
  readonly id: number;
  readonly title: string;
  readonly started_at: number;
  readonly ended_at: number | null;
  readonly duration_ms: number;
  readonly engine_id: string;
  readonly model_id: string;
  readonly language: string | null;
  readonly audio_path: string | null;
  readonly audio_bytes: number;
  readonly speaker_count: number;
  readonly word_count: number;
  readonly state: "recording" | "complete" | "interrupted";
}

interface SegmentRow {
  readonly id: number;
  readonly meeting_id: number;
  readonly start_ms: number;
  readonly end_ms: number;
  readonly source: "system" | "microphone";
  readonly speaker_key: string;
  readonly text: string;
  readonly gap: number;
}

interface SpeakerRow {
  readonly meeting_id: number;
  readonly speaker_key: string;
  readonly label: string;
}

const toRecord = (row: MeetingRow): MeetingRecord => ({
  id: row.id,
  title: row.title,
  startedAtMs: row.started_at,
  endedAtMs: row.ended_at,
  durationMs: row.duration_ms,
  engineId: row.engine_id,
  modelId: row.model_id,
  language: row.language,
  audioPath: row.audio_path,
  audioBytes: row.audio_bytes,
  speakerCount: row.speaker_count,
  wordCount: row.word_count,
  state: row.state
});

const toSegment = (row: SegmentRow): MeetingSegment => ({
  id: row.id,
  meetingId: row.meeting_id,
  startMs: row.start_ms,
  endMs: row.end_ms,
  source: row.source,
  speakerKey: row.speaker_key,
  text: row.text,
  gap: row.gap !== 0
});

export const createMeetingStore = (db: Database.Database): MeetingStore => {
  const createMeeting = (input: {
    title: string;
    engineId: string;
    modelId: string;
    language: string | null;
    audioPath: string | null;
  }): number => {
    const result = db
      .prepare(
        `INSERT INTO meetings (title, started_at, engine_id, model_id, language, audio_path, state)
         VALUES (?, ?, ?, ?, ?, ?, 'recording')`
      )
      .run(
        input.title,
        Date.now(),
        input.engineId,
        input.modelId,
        input.language,
        input.audioPath
      );
    return Number(result.lastInsertRowid);
  };

  const appendSegment = (input: Omit<MeetingSegment, "id">): number => {
    const result = db
      .prepare(
        `INSERT INTO meeting_segments
           (meeting_id, start_ms, end_ms, source, speaker_key, text, gap, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.meetingId,
        input.startMs,
        input.endMs,
        input.source,
        input.speakerKey,
        input.text,
        input.gap ? 1 : 0,
        Date.now()
      );
    return Number(result.lastInsertRowid);
  };

  const finalizeMeeting = (id: number, input: {
    endedAtMs: number;
    durationMs: number;
    audioBytes: number;
    speakerCount: number;
    state: "complete" | "interrupted";
  }): void => {
    db.prepare(
      `UPDATE meetings SET
         ended_at = ?, duration_ms = ?, audio_bytes = ?, speaker_count = ?, state = ?
       WHERE id = ?`
    ).run(
      input.endedAtMs,
      input.durationMs,
      input.audioBytes,
      input.speakerCount,
      input.state,
      id
    );
    // Word count is derived from the segments that exist at finalize time.
    const count = db
      .prepare(
        `SELECT COALESCE(SUM(${WORD_COUNT}), 0) AS words FROM meeting_segments
         WHERE meeting_id = ? AND gap = 0`
      )
      .get(id) as { words: number };
    db.prepare("UPDATE meetings SET word_count = ? WHERE id = ?").run(count.words, id);
  };

  const setTitle = (id: number, title: string): boolean => {
    const result = db
      .prepare("UPDATE meetings SET title = ? WHERE id = ?")
      .run(title, id);
    return result.changes > 0;
  };

  const setAudioPath = (id: number, audioPath: string): void => {
    // The meeting id only exists after the row is written, so the archive
    // path is backfilled once the directory is known.
    db.prepare("UPDATE meetings SET audio_path = ? WHERE id = ?").run(audioPath, id);
  };

  const setSpeakerLabel = (id: number, speakerKey: string, label: string): void => {
    db.prepare(
      `INSERT INTO meeting_speakers (meeting_id, speaker_key, label) VALUES (?, ?, ?)
       ON CONFLICT (meeting_id, speaker_key) DO UPDATE SET label = excluded.label`
    ).run(id, speakerKey, label);
  };

  const mergeSpeaker = (id: number, from: string, into: string): number => {
    if (from === into) return 0;
    const moved = db
      .prepare(
        "UPDATE meeting_segments SET speaker_key = ? WHERE meeting_id = ? AND speaker_key = ?"
      )
      .run(into, id, from).changes;
    // A label the user typed against the retired key follows the segments,
    // but only into an empty slot: a name they gave the surviving speaker is
    // the one they meant and must not be overwritten by the merge.
    db.prepare(
      `INSERT INTO meeting_speakers (meeting_id, speaker_key, label)
       SELECT ?, ?, label FROM meeting_speakers
       WHERE meeting_id = ? AND speaker_key = ?
       ON CONFLICT (meeting_id, speaker_key) DO NOTHING`
    ).run(id, into, id, from);
    db.prepare("DELETE FROM meeting_speakers WHERE meeting_id = ? AND speaker_key = ?").run(
      id,
      from
    );
    return moved;
  };

  const listMeetings = (limit: number, offset: number): MeetingRecord[] => {
    const rows = db
      .prepare("SELECT * FROM meetings ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as unknown as MeetingRow[];
    return rows.map(toRecord);
  };

  const countMeetings = (): number => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM meetings").get() as { n: number };
    return row.n;
  };

  const getMeeting = (id: number): MeetingRecord | null => {
    const row = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as
      | MeetingRow
      | undefined;
    return row === undefined ? null : toRecord(row);
  };

  const listSpeakers = (id: number): MeetingSpeaker[] => {
    const rows = db
      .prepare("SELECT * FROM meeting_speakers WHERE meeting_id = ? ORDER BY speaker_key")
      .all(id) as unknown as SpeakerRow[];
    return rows.map((row) => ({ speakerKey: row.speaker_key, label: row.label }));
  };

  const listSegments = (id: number, limit: number, offset: number): MeetingSegment[] => {
    const rows = db
      .prepare(
        `SELECT * FROM meeting_segments
         WHERE meeting_id = ? ORDER BY start_ms ASC, id ASC LIMIT ? OFFSET ?`
      )
      .all(id, limit, offset) as unknown as SegmentRow[];
    return rows.map(toSegment);
  };

  const countSegments = (id: number): number => {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM meeting_segments WHERE meeting_id = ?")
      .get(id) as { n: number };
    return row.n;
  };

  const searchSegments = (query: string, limit: number): MeetingSearchHit[] => {
    const sanitized = sanitizeFtsQuery(query);
    if (sanitized.length === 0) return [];
    const rows = db
      .prepare(
        `SELECT s.id, s.meeting_id, s.start_ms, s.end_ms, s.source, s.speaker_key,
                s.text, s.gap, m.title AS meeting_title, m.started_at AS meeting_started_at
         FROM meeting_segments s
         JOIN meetings m ON m.id = s.meeting_id
         WHERE s.id IN (
           SELECT rowid FROM meeting_segments_fts WHERE meeting_segments_fts MATCH ?
         )
         ORDER BY s.meeting_id DESC, s.start_ms ASC LIMIT ?`
      )
      .all(sanitized, limit) as unknown as Array<
      SegmentRow & { meeting_title: string; meeting_started_at: number }
    >;
    return rows.map((row) => ({
      segment: toSegment(row),
      meetingTitle: row.meeting_title,
      meetingStartedAtMs: row.meeting_started_at
    }));
  };

  const removeMeeting = (id: number): boolean => {
    const result = db.prepare("DELETE FROM meetings WHERE id = ?").run(id);
    return result.changes > 0;
  };

  const markInterruptedOnBoot = (): number => {
    const result = db
      .prepare("UPDATE meetings SET state = 'interrupted' WHERE state = 'recording'")
      .run();
    return result.changes;
  };

  const listExpired = (cutoffMs: number): { id: number; audioPath: string | null }[] => {
    const rows = db
      .prepare("SELECT id, audio_path FROM meetings WHERE started_at < ?")
      .all(cutoffMs) as unknown as Array<{ id: number; audio_path: string | null }>;
    return rows.map((row) => ({ id: row.id, audioPath: row.audio_path }));
  };

  return {
    createMeeting,
    appendSegment,
    finalizeMeeting,
    setTitle,
    setAudioPath,
    setSpeakerLabel,
    mergeSpeaker,
    listMeetings,
    countMeetings,
    getMeeting,
    listSpeakers,
    listSegments,
    countSegments,
    searchSegments,
    removeMeeting,
    markInterruptedOnBoot,
    listExpired
  };
};
