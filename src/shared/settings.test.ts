import { describe, expect, it } from "vitest";
import {
  applySettingsPatch,
  speechLanguageHint,
  DEFAULT_SETTINGS,
  dictionaryFileSchema,
  meetingSettingsSchema,
  migrateSettings,
  settingsSchema,
  shouldRunOnboarding
} from "./settings";
import { DEFAULT_ENGINE_ID, ENGINE_OPTIONS, MOCK_ENGINE_ID } from "./engines";
import { DEFAULT_MEETING_ACCELERATOR } from "./hotkeys";

/**
 * The migration path matters more than the schema: an existing install has a
 * settings.json written before the onboarding block existed, and reading it
 * must not replay onboarding at someone who already configured the app.
 */

const legacySettings = {
  version: 1,
  minCaptureMs: 350,
  pttAccelerator: "CommandOrControl+Space",
  engine: { primary: "parakeet", fallback: null },
  whisperModelId: "whisper-base-q5_1"
};

describe("settings migration", () => {
  it("defaults the maximum capture duration to five minutes", () => {
    expect(DEFAULT_SETTINGS.maxCaptureMs).toBe(300_000);
  });

  it("fills the onboarding block for settings written before it existed", () => {
    const settings = migrateSettings(legacySettings);
    expect(settings.onboarding.completed).toBe(false);
    expect(settings.onboarding.hardware).toBeNull();
    expect(settings.engine.primary).toBe("parakeet");
    expect(settings.automaticPaste).toBe(true);
  });

  it("preserves a stored onboarding block", () => {
    const settings = migrateSettings({
      ...legacySettings,
      onboarding: {
        completed: true,
        completedVersion: 1,
        hardware: { cpuCores: 8, cpuModel: "Ryzen", totalMemGb: 16 }
      }
    });
    expect(settings.onboarding.completed).toBe(true);
    expect(settings.onboarding.completedVersion).toBe(1);
    expect(settings.onboarding.hardware?.cpuCores).toBe(8);
    // Unspecified hardware fields fall back rather than failing the parse.
    expect(settings.onboarding.hardware?.gpuVendor).toBe("unknown");
  });

  it("falls back to defaults on unparseable input", () => {
    expect(migrateSettings("not settings").onboarding.completed).toBe(false);
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("drops an invalid onboarding block rather than throwing", () => {
    const settings = migrateSettings({ ...legacySettings, onboarding: { completed: "yes" } });
    expect(settings.onboarding.completed).toBe(false);
  });

  it("defaults onboarding to incomplete on a fresh install", () => {
    expect(settingsSchema.parse({}).onboarding.completed).toBe(false);
  });

  it("preserves automatic paste when it is disabled", () => {
    expect(migrateSettings({ ...legacySettings, automaticPaste: false }).automaticPaste).toBe(false);
  });

  it("parses a dictionary entry without enabled to enabled: true", () => {
    const migrated = migrateSettings({
      post: {
        dictionary: [{ from: "struck", to: "Struq", matchCase: false, wholeWord: true }],
        removeFillers: false,
        addTrailingPunctuation: false
      }
    });
    expect(migrated.post.dictionary[0]?.enabled).toBe(true);
  });

  it("fills the meeting block for settings written before it existed", () => {
    const settings = migrateSettings(legacySettings);
    expect(settings.meeting.includeMicrophone).toBe(true);
    expect(settings.meeting.accelerator).toBe(DEFAULT_MEETING_ACCELERATOR);
    expect(settings.meeting.engineId).toBe("parakeet");
    expect(settings.meeting.diarization).toBe(true);
    expect(settings.meeting.diarizationRefineOverMs).toBe(15_000);
    expect(settings.meeting.speakerThreshold).toBe(0.55);
    expect(settings.meeting.speakerMergeThreshold).toBe(0.55);
    expect(settings.meeting.minSpeakerAudioMs).toBe(3000);
    expect(settings.meeting.maxSpeakers).toBe(0);
    expect(settings.meeting.archiveAudio).toBe(true);
    expect(settings.meeting.archiveBitrateKbps).toBe(32);
    expect(settings.meeting.vadMinSpeechMs).toBe(250);
    expect(settings.meeting.vadMinSilenceMs).toBe(500);
    expect(settings.meeting.vadMaxSpeechMs).toBe(20_000);
    expect(settings.meeting.autoStopSilentMinutes).toBe(0);
    expect(settings.meeting.retentionDays).toBe(0);
  });

  it("rejects a cloud engine for meetings", () => {
    expect(meetingSettingsSchema.safeParse({ engineId: "openrouter" }).success).toBe(false);
  });
});

describe("dictionaryFileSchema", () => {
  it("validates a correct dictionary export file", () => {
    const valid = {
      kind: "struq-voice-dictionary" as const,
      version: 1 as const,
      entries: [{ from: "struck", to: "Struq", matchCase: false, wholeWord: true, enabled: true }]
    };

    expect(dictionaryFileSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a file with the wrong kind", () => {
    const invalid = {
      kind: "wrong-kind",
      version: 1,
      entries: []
    };
    expect(dictionaryFileSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("shouldRunOnboarding", () => {
  it("runs on a fresh install", () => {
    expect(shouldRunOnboarding(DEFAULT_SETTINGS)).toBe(true);
  });

  it("does not run once completed", () => {
    const settings = migrateSettings({
      onboarding: { completed: true, completedVersion: 1, hardware: null }
    });
    expect(shouldRunOnboarding(settings)).toBe(false);
  });

  /**
   * The engine is no longer part of the decision. It used to stand in for
   * "has this person chosen anything", which only held while the mock was the
   * default. With a real default it says nothing, so the completed flag is the
   * only signal. A legacy profile without the flag now sees onboarding once,
   * which is a deliberate change from the previous behaviour.
   */
  it("ignores the engine and reads only the completed flag", () => {
    const settings = migrateSettings(legacySettings);
    expect(settings.onboarding.completed).toBe(false);
    expect(shouldRunOnboarding(settings)).toBe(true);
  });
});

describe("engine defaults", () => {
  it("defaults a fresh profile to a real engine, never the mock", () => {
    expect(DEFAULT_SETTINGS.engine.primary).toBe(DEFAULT_ENGINE_ID);
    expect(DEFAULT_SETTINGS.engine.primary).not.toBe(MOCK_ENGINE_ID);
  });

  it("does not offer the mock as a selectable engine", () => {
    expect(ENGINE_OPTIONS.map((option) => option.id)).not.toContain(MOCK_ENGINE_ID);
  });
});

/**
 * A rejected patch must cost the caller its patch, never the user's profile.
 * The model picker used to send an empty whisperModelId when a Parakeet model
 * was chosen; merging that through migrateSettings failed the whole object
 * and silently reset theme, hotkeys, speech language and the dictionary.
 */
describe("applySettingsPatch", () => {
  const configured = migrateSettings({
    ...DEFAULT_SETTINGS,
    theme: "dark",
    pttAccelerator: "Alt+X",
    speechLanguage: "nl",
    whisperModelId: "whisper-small-q8_0"
  });

  it("applies a valid patch", () => {
    const next = applySettingsPatch(configured, {
      engine: { primary: "whisper-cpp", fallback: null }
    });
    expect(next.engine.primary).toBe("whisper-cpp");
    expect(next.theme).toBe("dark");
  });

  it("keeps every other setting when one field of a patch is invalid", () => {
    const next = applySettingsPatch(configured, {
      engine: { primary: "parakeet", fallback: null },
      whisperModelId: "",
      parakeetModelId: "parakeet-tdt-0.6b-v2-int8"
    });
    expect(next.theme).toBe("dark");
    expect(next.pttAccelerator).toBe("Alt+X");
    expect(next.speechLanguage).toBe("nl");
  });

  it("lands the valid fields of a partly invalid patch", () => {
    const next = applySettingsPatch(configured, {
      engine: { primary: "parakeet", fallback: null },
      whisperModelId: "",
      parakeetModelId: "parakeet-tdt-0.6b-v2-int8"
    });
    expect(next.engine.primary).toBe("parakeet");
    expect(next.parakeetModelId).toBe("parakeet-tdt-0.6b-v2-int8");
  });

  it("drops only the rejected field and keeps the previous value", () => {
    const next = applySettingsPatch(configured, { whisperModelId: "" });
    expect(next.whisperModelId).toBe("whisper-small-q8_0");
  });
});

/**
 * The speech language is a decoder hint, not only a post-processing detail.
 * Dictation used to send nothing, so Whisper and OpenRouter auto-detected
 * every utterance and a Dutch dictation could come back with English words
 * in it. Dictation and meetings must agree on what the setting means.
 */
describe("speechLanguageHint", () => {
  it("returns null for the auto sentinel so the engine detects", () => {
    expect(speechLanguageHint("auto")).toBeNull();
  });

  it("passes a plain language code through", () => {
    expect(speechLanguageHint("nl")).toBe("nl");
  });

  it("reduces a regional tag to the base subtag the decoders accept", () => {
    expect(speechLanguageHint("pt-BR")).toBe("pt");
    expect(speechLanguageHint("en-US")).toBe("en");
  });

  it("treats an empty or whitespace value as no hint", () => {
    expect(speechLanguageHint("")).toBeNull();
    expect(speechLanguageHint("   ")).toBeNull();
  });
});
