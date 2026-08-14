import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Settings } from "../../shared/settings";
import { applySettingsPatch, DEFAULT_SETTINGS, migrateSettings } from "../../shared/settings";

export interface SettingsStore {
  get: () => Settings;
  update: (patch: Partial<Settings>) => void;
  subscribe: (listener: (settings: Settings) => void) => () => void;
  /**
   * Why the last write failed, or null when settings are on disk. The UI
   * reads this to stop reporting a change as saved when it only ever
   * reached memory.
   */
  lastWriteError: () => string | null;
}

/**
 * A JSON settings file, validated through the zod schema at every read.
 * Settings change rarely and are tiny, so writes are synchronous and
 * immediate.
 *
 * Writes go through a temp file and a rename. A direct write leaves a
 * truncated file behind if the process dies mid-save, and a truncated file
 * cannot be parsed at all, so the profile it held is gone: the salvage in
 * migrateSettings can only rescue a file that is still JSON. Rename is
 * atomic on Windows for a same-directory target, so a reader sees either
 * the old file or the new one.
 */
export const createSettingsStore = (filePath: string): SettingsStore => {
  let settings: Settings = DEFAULT_SETTINGS;
  let writeError: string | null = null;
  const listeners = new Set<(settings: Settings) => void>();

  try {
    const raw = readFileSync(filePath, "utf-8");
    settings = migrateSettings(JSON.parse(raw) as unknown);
  } catch {
    // Missing or unreadable file: defaults are fine. A file that parses but
    // fails validation is salvaged field by field inside migrateSettings.
  }

  const save = (): void => {
    const tempPath = `${filePath}.tmp`;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(tempPath, JSON.stringify(settings, null, 2), "utf-8");
      renameSync(tempPath, filePath);
      writeError = null;
    } catch (error) {
      // A settings write failure must not take the app down, but it must not
      // pass for success either: the change lives in memory for this session
      // and is gone at the next boot, and the user is entitled to know.
      writeError = error instanceof Error ? error.message : "Could not save settings.";
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {
        // A leftover temp file is untidy, not harmful.
      }
    }
  };

  return {
    get: () => settings,
    update: (patch: Partial<Settings>) => {
      settings = applySettingsPatch(settings, patch);
      save();
      for (const listener of listeners) {
        listener(settings);
      }
    },
    subscribe: (listener: (settings: Settings) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lastWriteError: () => writeError
  };
};
