import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  settingsSchema,
  shouldRunOnboarding
} from "./settings";
import { MOCK_ENGINE_ID } from "./engines";

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
  it("fills the onboarding block for settings written before it existed", () => {
    const settings = migrateSettings(legacySettings);
    expect(settings.onboarding.completed).toBe(false);
    expect(settings.onboarding.hardware).toBeNull();
    expect(settings.engine.primary).toBe("parakeet");
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
});

describe("shouldRunOnboarding", () => {
  it("runs on a fresh install", () => {
    expect(shouldRunOnboarding(DEFAULT_SETTINGS, MOCK_ENGINE_ID)).toBe(true);
  });

  it("does not run once completed", () => {
    const settings = migrateSettings({
      onboarding: { completed: true, completedVersion: 1, hardware: null }
    });
    expect(shouldRunOnboarding(settings, MOCK_ENGINE_ID)).toBe(false);
  });

  // The case that matters on upgrade: a settings.json with no onboarding
  // block but a real engine belongs to someone who set this up by hand.
  it("does not run for an existing install that already picked an engine", () => {
    const settings = migrateSettings(legacySettings);
    expect(settings.onboarding.completed).toBe(false);
    expect(shouldRunOnboarding(settings, MOCK_ENGINE_ID)).toBe(false);
  });
});
