/**
 * Settings schema, defaults and migration. Zod at the process boundary: the
 * store validates everything that comes from disk, then main trusts the
 * types. No side effects, no Electron imports.
 */

import { z } from "zod";
import { hardwareProfileSchema } from "./hardware";
import { DEFAULT_ENGINE_ID } from "./engines";
import { DEFAULT_PTT_ACCELERATOR, DEFAULT_MEETING_ACCELERATOR, DEFAULT_TOGGLE_ACCELERATOR } from "./hotkeys";
import { DEFAULT_WHISPER_MODEL_ID, PARAKEET_DEFAULT_MODEL_ID } from "./models";

export const dictionaryEntrySchema = z.object({
  from: z.string().min(1),
  to: z.string(),
  matchCase: z.boolean().default(false),
  wholeWord: z.boolean().default(true),
  /** Off keeps the rule in the list without applying it. */
  enabled: z.boolean().default(true)
});

export const dictionaryFileSchema = z.object({
  kind: z.literal("struq-voice-dictionary"),
  version: z.literal(1),
  entries: z.array(dictionaryEntrySchema)
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

export const meetingSettingsSchema = z.object({
  /** Mix your own microphone into the recording and transcribe it as "You". */
  includeMicrophone: z.boolean().default(true),
  /** Toggle accelerator for starting and stopping a meeting. */
  accelerator: z.string().min(1).default(DEFAULT_MEETING_ACCELERATOR),
  /**
   * Which engine transcribes meetings. Local only: a meeting is hours of
   * audio and sending it to a cloud engine is both a bill and a disclosure
   * nobody agreed to. The router is not involved and there is no fallback.
   */
  engineId: z.enum(["parakeet", "whisper-cpp"]).default("parakeet"),
  /** Label speakers on the system lane. Off makes every remote line "Speaker". */
  diarization: z.boolean().default(true),
  /**
   * Utterances longer than this are re-segmented before embedding, so a turn
   * where two people overlap is not collapsed onto one speaker. 0 disables
   * the refinement stage and skips the segmentation model entirely.
   */
  diarizationRefineOverMs: z.number().int().min(0).max(60_000).default(15_000),
  /**
   * Similarity above which a voice is judged to be a speaker already heard.
   * Higher splits one person into several; lower merges two people. Scored
   * against a speaker's recent utterances, not against a single average.
   */
  speakerThreshold: z.number().min(0.2).max(0.95).default(0.55),
  /**
   * Mean similarity between two speakers' recent utterances above which they
   * are judged to be the same person and folded together. A different measure
   * from speakerThreshold, so the two numbers are not comparable.
   */
  speakerMergeThreshold: z.number().min(0.2).max(0.95).default(0.55),
  /**
   * Speech shorter than this can be labelled but never registers a speaker.
   * A speaker embedding taken from under roughly three seconds carries almost
   * no identity: measured against a ten second reference of the same voice,
   * CAM++ scores 0.05 at 300ms and 0.15 at one second. Letting those found
   * speakers is what turned a two person call into six.
   */
  minSpeakerAudioMs: z.number().int().min(500).max(10_000).default(3000),
  /** Hard cap on distinct speakers. 0 lets the clustering decide. */
  maxSpeakers: z.number().int().min(0).max(32).default(0),
  /** Keep the mixed opus recording beside the transcript. */
  archiveAudio: z.boolean().default(true),
  archiveBitrateKbps: z.number().int().min(16).max(128).default(32),
  /** Silero: speech shorter than this is not an utterance (ms). */
  vadMinSpeechMs: z.number().int().min(100).max(2000).default(250),
  /** Silero: silence this long closes an utterance (ms). */
  vadMinSilenceMs: z.number().int().min(200).max(3000).default(500),
  /** Silero: force a boundary in a monologue (ms). */
  vadMaxSpeechMs: z.number().int().min(5000).max(60_000).default(20_000),
  /** Stop a meeting nobody is in. 0 never auto-stops. Minutes. */
  autoStopSilentMinutes: z.number().int().min(0).max(120).default(0),
  /** Delete meetings older than this. 0 keeps them forever. Days. */
  retentionDays: z.number().int().min(0).max(3650).default(0)
});

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  /** Whether the user has been notified once that close hides to the tray. */
  firstHideNotified: z.boolean().default(false),
  /** The appearance of every window: follow the OS, or force one mode. */
  theme: z.enum(["system", "light", "dark"]).default("system"),
  /** "system" follows the Windows language list; anything else forces a locale. */
  locale: z.string().default("system"),
  /** "auto" lets the engine detect; otherwise a BCP47 tag forced on the decoder. */
  speechLanguage: z.string().default("auto"),
  /** Captures shorter than this (ms) are discarded silently. */
  minCaptureMs: z.number().int().min(100).max(5000).default(350),
  /** Force-stop a capture that ran this long (ms). Defaults to 5 minutes (300,000 ms). */
  maxCaptureMs: z.number().int().min(5000).max(600000).default(300_000),
  /** Pre-roll: audio kept from before the key was pressed (ms). */
  prerollMs: z.number().int().min(0).max(1000).default(250),
  /** Insert completed dictation into the active application. */
  automaticPaste: z.boolean().default(true),
  /** Restore the clipboard after a synthesized paste. */
  restoreClipboard: z.boolean().default(true),
  /** How long to wait before restoring the clipboard (ms). */
  restoreClipboardDelayMs: z.number().int().min(0).max(5000).default(400),
  /** Synthesize an Enter keystroke into the active window after pasting. */
  pressEnterAfterPaste: z.boolean().default(false),
  /** Start with Windows, hidden to the tray. */
  autostart: z.boolean().default(false),
  /** Press-and-hold accelerator ("CommandOrControl+Space"). */
  pttAccelerator: z.string().min(1).default(DEFAULT_PTT_ACCELERATOR),
  /** Toggle accelerator ("CommandOrControl+Shift+Space"). */
  toggleAccelerator: z.string().min(1).default(DEFAULT_TOGGLE_ACCELERATOR),
  /**
   * Parakeet is the default: local, private, and needs no API key. A fresh
   * profile lands on a real engine and shows "download the model", which is a
   * setup step. The old default was the mock, which transcribed nothing and
   * looked like a working app producing nonsense.
   */
  engine: z
    .object({
      primary: z.string().min(1).default(DEFAULT_ENGINE_ID),
      fallback: z.string().nullable().default(null)
    })
    .default({ primary: DEFAULT_ENGINE_ID, fallback: null }),
  /** Catalog id of the whisper.cpp model the engine loads. */
  whisperModelId: z.string().min(1).default(DEFAULT_WHISPER_MODEL_ID),
  /** Catalog id of the parakeet model the engine loads. */
  parakeetModelId: z.string().min(1).default(PARAKEET_DEFAULT_MODEL_ID),
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
  }),
  meeting: meetingSettingsSchema.default({
    includeMicrophone: true,
    accelerator: DEFAULT_MEETING_ACCELERATOR,
    engineId: "parakeet",
    diarization: true,
    diarizationRefineOverMs: 15_000,
    speakerThreshold: 0.55,
    speakerMergeThreshold: 0.55,
    minSpeakerAudioMs: 3000,
    maxSpeakers: 0,
    archiveAudio: true,
    archiveBitrateKbps: 32,
    vadMinSpeechMs: 250,
    vadMinSilenceMs: 500,
    vadMaxSpeechMs: 20_000,
    autoStopSilentMinutes: 0,
    retentionDays: 0
  })
});

export type Settings = z.infer<typeof settingsSchema>;
export type MeetingSettings = z.infer<typeof meetingSettingsSchema>;
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
 * Apply a patch to a known-good settings object.
 *
 * A patch that fails validation must cost the caller its patch, never the
 * user's profile. Going through migrateSettings meant one rejected field
 * (an empty model id from the model picker) failed the whole object and
 * silently reset theme, hotkeys, dictionary and onboarding to defaults.
 * Bad keys are dropped one at a time and the rest of the patch still lands.
 */
export const applySettingsPatch = (
  current: Settings,
  patch: Partial<Settings>
): Settings => {
  const merged = settingsSchema.safeParse({ ...current, ...patch });
  if (merged.success) return merged.data;
  const accepted: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const candidate = settingsSchema.safeParse({ ...accepted, [key]: value });
    if (candidate.success) {
      accepted[key] = value;
    }
  }
  return migrateSettings(accepted);
};

/**
 * Whether onboarding should run.
 *
 * The flag is the only authority now. It used to be inferred from the engine
 * still being the mock, which worked while the mock was the default: anyone
 * sitting on it had not chosen. With a real engine as the default that test
 * is always false, so a new user would never be onboarded. An install that
 * predates the onboarding block parses with `completed: false` and gets the
 * flow once, which is the correct outcome for it too.
 */
export const shouldRunOnboarding = (settings: Settings): boolean =>
  !settings.onboarding.completed;
