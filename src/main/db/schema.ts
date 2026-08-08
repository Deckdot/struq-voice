import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";

export const transcripts = sqliteTable("transcripts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  engineId: text("engine_id").notNull(),
  modelId: text("model_id").notNull(),
  durationMs: integer("duration_ms").notNull(),
  inferenceMs: integer("inference_ms"),
  costUsd: real("cost_usd"),
  language: text("language"),
  createdAt: integer("created_at").notNull()
});

export const meetings = sqliteTable("meetings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  durationMs: integer("duration_ms").notNull().default(0),
  engineId: text("engine_id").notNull(),
  modelId: text("model_id").notNull(),
  language: text("language"),
  audioPath: text("audio_path"),
  audioBytes: integer("audio_bytes").notNull().default(0),
  speakerCount: integer("speaker_count").notNull().default(0),
  wordCount: integer("word_count").notNull().default(0),
  state: text("state").notNull()
});

export const meetingSegments = sqliteTable("meeting_segments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  meetingId: integer("meeting_id")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  source: text("source").notNull(),
  speakerKey: text("speaker_key").notNull(),
  text: text("text").notNull(),
  gap: integer("gap").notNull().default(0),
  createdAt: integer("created_at").notNull()
});

export const meetingSpeakers = sqliteTable("meeting_speakers", {
  meetingId: integer("meeting_id")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  speakerKey: text("speaker_key").notNull(),
  label: text("label").notNull()
});
