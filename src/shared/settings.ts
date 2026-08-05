/**
 * Settings schema, defaults and migration. Zod at the process boundary: the
 * store validates everything that comes from disk, then main trusts the
 * types. No side effects, no Electron imports.
 */

import { z } from "zod";
import { DEFAULT_PTT_ACCELERATOR, DEFAULT_TOGGLE_ACCELERATOR } from "./hotkeys";
import { DEFAULT_WHISPER_MODEL_ID } from "./models";

export const dictionaryEntrySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  matchCase: z.boolean().default(false),
  wholeWord: z.boolean().default(true)
});

export const postProcessingSchema = z.object({
  dictionary: z.array(dictionaryEntrySchema).default([]),
  removeFillers: z.boolean().default(false),
  addTrailingPunctuation: z.boolean().default(false)
});

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  /** Captures shorter than this (ms) are discarded silently. */
  minCaptureMs: z.number().int().min(100).max(5000).default(350),
  /** Force-stop a capture that ran this long (ms). */
  maxCaptureMs: z.number().int().min(5000).max(600000).default(120000),
  /** Pre-roll: audio kept from before the key was pressed (ms). */
  prerollMs: z.number().int().min(0).max(1000).default(250),
  /** Restore the clipboard after a synthesized paste. */
  restoreClipboard: z.boolean().default(true),
  /** How long to wait before restoring the clipboard (ms). */
  restoreClipboardDelayMs: z.number().int().min(0).max(5000).default(400),
  /** Start with Windows, hidden to the tray. */
  autostart: z.boolean().default(false),
  /** Press-and-hold accelerator ("CommandOrControl+Space"). */
  pttAccelerator: z.string().min(1).default(DEFAULT_PTT_ACCELERATOR),
  /** Toggle accelerator ("CommandOrControl+Shift+Space"). */
  toggleAccelerator: z.string().min(1).default(DEFAULT_TOGGLE_ACCELERATOR),
  engine: z
    .object({
      primary: z.string().min(1).default("mock"),
      fallback: z.string().nullable().default(null)
    })
    .default({ primary: "mock", fallback: null }),
  /** Catalog id of the whisper.cpp model the engine loads. */
  whisperModelId: z.string().min(1).default(DEFAULT_WHISPER_MODEL_ID),
  post: postProcessingSchema.default({
    dictionary: [],
    removeFillers: false,
    addTrailingPunctuation: false
  })
});

export type Settings = z.infer<typeof settingsSchema>;
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/**
 * Validate and upgrade an arbitrary persisted value to the current schema.
 * Unknown fields are dropped, missing fields get defaults.
 */
export const migrateSettings = (raw: unknown): Settings => {
  const parsed = settingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return settingsSchema.parse({});
};
