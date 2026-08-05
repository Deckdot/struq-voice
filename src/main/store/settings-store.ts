import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Settings } from "../../shared/settings";
import { DEFAULT_SETTINGS, migrateSettings } from "../../shared/settings";

export interface SettingsStore {
  get: () => Settings;
  update: (patch: Partial<Settings>) => void;
  subscribe: (listener: (settings: Settings) => void) => () => void;
}

/**
 * A JSON settings file, validated through the zod schema at every read.
 * Settings change rarely and are tiny, so writes are synchronous and
 * immediate.
 */
export const createSettingsStore = (filePath: string): SettingsStore => {
  let settings: Settings = DEFAULT_SETTINGS;
  const listeners = new Set<(settings: Settings) => void>();

  try {
    const raw = readFileSync(filePath, "utf-8");
    settings = migrateSettings(JSON.parse(raw) as unknown);
  } catch {
    // Missing or unreadable file: defaults are fine.
  }

  const save = (): void => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf-8");
    } catch {
      // A settings write failure must not take the app down.
    }
  };

  return {
    get: () => settings,
    update: (patch: Partial<Settings>) => {
      settings = migrateSettings({ ...settings, ...patch });
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
    }
  };
};
