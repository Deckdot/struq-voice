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
