/**
 * Settings schema, defaults and migration. Zod at the process boundary: the
 * store validates everything that comes from disk, then main trusts the
 * types. No side effects, no Electron imports.
 */

import { z } from "zod";
import { hardwareProfileSchema } from "./hardware";
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

/**
 * First-run state. Lives in settings rather than renderer localStorage so
 * main can gate the window on it and clearing the web cache cannot replay
 * onboarding at an established user. The hardware snapshot is kept so the
 * Models view can name the machine without re-probing.
 */
export const onboardingSchema = z.object({
  completed: z.boolean().default(false),
  /** ONBOARDING_VERSION at the time it was completed. */
  completedVersion: z.number().int().min(0).default(0),
  hardware: hardwareProfileSchema.nullable().default(null)
});

/** Bump to replay onboarding after a change that needs the user to see it. */
export const ONBOARDING_VERSION = 1;

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  /** The appearance of every window: follow the OS, or force one mode. */
  theme: z.enum(["system", "light", "dark"]).default("system"),
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
  /** Play a short sound when a capture starts and when it ends. */
  captureSounds: z.boolean().default(true),
  /** Capture sound volume, 0 to 1. */
  captureSoundVolume: z.number().min(0).max(1).default(0.4),
  /**
   * Show a running transcript in the capture panel while still speaking.
   *
   * Off by default, and deliberately so: partials come from re-decoding the
   * audio so far on an interval, which is real CPU spent on top of the
   * transcription that actually matters. On a slow machine that competes with
   * the final pass. Users who dictate long passages can turn it on.
   */
  liveTranscription: z.boolean().default(false),
  /** How often to re-decode while listening (ms). */
  liveTranscriptionIntervalMs: z.number().int().min(400).max(10000).default(1200),
  /**
   * Where the user last dragged the capture panel, in screen coordinates.
   * Re-clamped to a live display on use, so a monitor that disappears cannot
   * strand the panel off-screen.
   */
  overlayPosition: z
    .object({ x: z.number(), y: z.number() })
    .nullable()
    .default(null),
  post: postProcessingSchema.default({
    dictionary: [],
    removeFillers: false,
    addTrailingPunctuation: false
  }),
  onboarding: onboardingSchema.default({
    completed: false,
    completedVersion: 0,
    hardware: null
  })
});

export type Settings = z.infer<typeof settingsSchema>;
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;
export type OnboardingState = z.infer<typeof onboardingSchema>;

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

/**
 * Whether onboarding should run. An install that predates the onboarding
 * block parses with `completed: false`, so completion is also inferred: a
 * user who already picked a real engine has done the setup by hand and must
 * not be walked through it again.
 */
export const shouldRunOnboarding = (settings: Settings, mockEngineId: string): boolean => {
  if (settings.onboarding.completed) return false;
  return settings.engine.primary === mockEngineId;
};
