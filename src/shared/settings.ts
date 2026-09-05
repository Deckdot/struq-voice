/**
 * Settings schema, defaults and migration. Zod at the process boundary: the
 * store validates everything that comes from disk, then main trusts the
 * types. No side effects, no Electron imports.
 */

import { z } from "zod";
import { hardwareProfileSchema } from "./hardware";
import { DEFAULT_ENGINE_ID } from "./engines";
import { DEFAULT_PTT_ACCELERATOR, DEFAULT_MEETING_ACCELERATOR, DEFAULT_TOGGLE_ACCELERATOR } from "./hotkeys";
import {
  DEFAULT_WHISPER_MODEL_ID,
  MEETING_DEFAULT_WHISPER_MODEL_ID,
  PARAKEET_DEFAULT_MODEL_ID
} from "./models";

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
   * Which engine transcribes meetings. This is independent from dictation,
   * and cloud processing is always an explicit choice with no fallback.
   */
  engineId: z.enum(["parakeet", "whisper-cpp", "openrouter"]).default("whisper-cpp"),
  /** Catalog id used when the meeting engine is whisper.cpp. */
  whisperModelId: z.string().min(1).default(MEETING_DEFAULT_WHISPER_MODEL_ID),
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
  vadMinSilenceMs: z.number().int().min(200).max(3000).default(650),
  /** Silero: force a boundary in a monologue (ms). */
  vadMaxSpeechMs: z.number().int().min(5000).max(60_000).default(30_000),
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
  /**
   * Force-stop a capture that ran this long (ms). A stuck-key watchdog, not a
   * length limit on dictation: raise it to 600,000 in Settings for long-form
   * takes. The default stays at five minutes because the recorder worklet
   * preallocates the whole window, and 10 minutes of 16kHz float samples is
   * 38MB held for a capability most captures never reach.
   */
  maxCaptureMs: z.number().int().min(5000).max(600_000).default(300_000),
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
    engineId: "whisper-cpp",
    whisperModelId: MEETING_DEFAULT_WHISPER_MODEL_ID,
    diarization: true,
    diarizationRefineOverMs: 15_000,
    speakerThreshold: 0.55,
    speakerMergeThreshold: 0.55,
    minSpeakerAudioMs: 3000,
    maxSpeakers: 0,
    archiveAudio: true,
    archiveBitrateKbps: 32,
    vadMinSpeechMs: 250,
    vadMinSilenceMs: 650,
    vadMaxSpeechMs: 30_000,
    autoStopSilentMinutes: 0,
    retentionDays: 0
  })
});

/**
 * The speech language as an engine hint.
 *
 * "auto" is the sentinel for "let the engine decide", not a language, so it
 * becomes null and the engine's own detection runs. Anything else is passed
 * to the decoder, which is what stops a Dutch dictation coming back with
 * English words: per-utterance auto-detect on a few seconds of speech is a
 * far weaker signal than the language the user already told us.
 *
 * Shared because dictation and meetings must not disagree about what "auto"
 * means. Engines without a language parameter (Parakeet is one fixed
 * multilingual model) ignore the hint.
 */
export const speechLanguageHint = (language: string): string | null => {
  if (language === "auto") return null;
  // Decoders want the base subtag: whisper.cpp rejects "pt-BR" where it
  // accepts "pt". The picker offers base codes today, but the setting is a
  // free string and a migrated or hand-edited profile can hold a full tag.
  const base = language.split("-")[0]?.trim().toLowerCase() ?? "";
  return base.length === 0 ? null : base;
};

/**
 * Every language the speech picker offers, in the order it shows them.
 *
 * Shared rather than inlined in the view: onboarding and Settings must offer
 * the same set, and the filler tables in `post/text-cleanup.ts` are keyed to
 * this list. A language offered without a filler table removes no fillers at
 * all, which is safe but silently useless, so the two are tested against this
 * array instead of a hand-copied duplicate of it.
 *
 * `auto` is not here: it is the "let the engine decide" sentinel, offered as
 * its own option with its own translated label.
 */
export const SPEECH_LANGUAGES: readonly { readonly code: string; readonly label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "German (Deutsch)" },
  { code: "fr", label: "French (Français)" },
  { code: "es", label: "Spanish (Español)" },
  { code: "it", label: "Italian (Italiano)" },
  { code: "nl", label: "Dutch (Nederlands)" },
  { code: "pt", label: "Portuguese (Português)" },
  { code: "pl", label: "Polish (Polski)" },
  { code: "ru", label: "Russian (Русский)" },
  { code: "zh", label: "Chinese (中文)" },
  { code: "ja", label: "Japanese (日本語)" },
  { code: "ko", label: "Korean (한국어)" },
  { code: "ar", label: "Arabic (العربية)" },
  { code: "hi", label: "Hindi (हिन्दी)" },
  { code: "tr", label: "Turkish (Türkçe)" },
  { code: "sv", label: "Swedish (Svenska)" },
  { code: "da", label: "Danish (Dansk)" },
  { code: "nb", label: "Norwegian (Norsk)" },
  { code: "fi", label: "Finnish (Suomi)" },
  { code: "uk", label: "Ukrainian (Українська)" }
];

/**
 * Pick the speech language to preselect from the OS preferred languages.
 *
 * Onboarding asks the user to confirm rather than guess, so the job here is
 * only to make the common case a single click. An OS language we do not offer
 * falls back to `auto`, which is the honest answer: we have no better guess
 * than the engine's own detection.
 */
export const preferredSpeechLanguage = (
  preferred: readonly string[]
): string => {
  for (const tag of preferred) {
    const base = tag.split("-")[0]?.trim().toLowerCase() ?? "";
    if (base.length === 0) continue;
    if (SPEECH_LANGUAGES.some((language) => language.code === base)) return base;
  }
  return "auto";
};

export type Settings = z.infer<typeof settingsSchema>;
export type MeetingSettings = z.infer<typeof meetingSettingsSchema>;
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;
export type OnboardingState = z.infer<typeof onboardingSchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/**
 * Take every field of `candidate` that validates on top of `base`, one key
 * at a time, and drop only the ones that do not.
 *
 * The whole-object `safeParse` is all-or-nothing: one bad field discards
 * every good one alongside it. That is how a single unrecognised value in
 * settings.json reset an entire configured profile, and how one rejected
 * key in a patch used to do the same.
 */
const salvageFields = (
  base: Settings,
  candidate: Record<string, unknown>
): Settings => {
  const accepted: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(candidate)) {
    const probe = settingsSchema.safeParse({ ...accepted, [key]: value });
    if (probe.success) {
      accepted[key] = value;
    }
  }
  const settled = settingsSchema.safeParse(accepted);
  return settled.success ? settled.data : { ...base };
};

/**
 * Validate and upgrade an arbitrary persisted value to the current schema.
 * Unknown fields are dropped, missing fields get defaults.
 *
 * A file that fails as a whole is salvaged field by field rather than
 * thrown away. A truncated write or one stale value used to cost the user
 * their theme, hotkeys, speech language, dictionary and onboarding state in
 * one silent step, and the next write committed that loss permanently.
 */
export const migrateSettings = (raw: unknown): Settings => {
  const parsed = settingsSchema.safeParse(raw);
  const settled = parsed.success
    ? parsed.data
    : typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? salvageFields(DEFAULT_SETTINGS, raw as Record<string, unknown>)
      : settingsSchema.parse({});

  // Profiles from the first meeting release had no meeting-specific model and
  // defaulted to Parakeet. Move only those untouched legacy defaults to the
  // quality-first Whisper path. A profile with an explicit model selection is
  // left alone so a deliberate Parakeet choice remains valid.
  const rawMeeting =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)["meeting"]
      : undefined;
  if (
    typeof rawMeeting === "object" &&
    rawMeeting !== null &&
    !Array.isArray(rawMeeting) &&
    !Object.prototype.hasOwnProperty.call(rawMeeting, "whisperModelId") &&
    settled.meeting.engineId === "parakeet"
  ) {
    return {
      ...settled,
      meeting: {
        ...settled.meeting,
        engineId: "whisper-cpp",
        whisperModelId: MEETING_DEFAULT_WHISPER_MODEL_ID
      }
    };
  }
  return settled;
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
  return salvageFields(current, patch);
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
