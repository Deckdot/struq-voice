/**
 * Secret storage via Electron safeStorage (DPAPI-backed on Windows).
 * Ported from StruqADE voice-service.ts:29-67. The raw key never crosses IPC;
 * settings shows a masked placeholder and a "Replace key" action only.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { Result } from "../../shared/result";
import { fail, ok } from "../../shared/result";

const keyPath = (): string => join(app.getPath("userData"), "secrets", "openrouter.enc");

export interface SecretsStore {
  /** Stored key, then OPENROUTER_API_KEY, then unconfigured. */
  readOpenRouterKey: () => Promise<string | null>;
  writeOpenRouterKey: (key: string) => Promise<Result<void>>;
}

export const createSecretsStore = (): SecretsStore => {
  const readStored = async (): Promise<string | null> => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const encrypted = await readFile(keyPath());
      return safeStorage.decryptString(encrypted);
    } catch {
      return null;
    }
  };

  return {
    readOpenRouterKey: async (): Promise<string | null> => {
      const stored = await readStored();
      if (stored !== null && stored.length > 0) return stored;
      const envKey = process.env["OPENROUTER_API_KEY"];
      if (envKey !== undefined && envKey.length > 0) return envKey;
      return null;
    },
    writeOpenRouterKey: async (key: string): Promise<Result<void>> => {
      if (!safeStorage.isEncryptionAvailable()) {
        return fail({
          code: "UNKNOWN",
          message:
            "Secure storage is not available on this system. Set the OPENROUTER_API_KEY environment variable instead."
        });
      }
      try {
        await mkdir(join(app.getPath("userData"), "secrets"), { recursive: true });
        const encrypted = safeStorage.encryptString(key);
        await writeFile(keyPath(), encrypted);
        return ok(undefined);
      } catch {
        return fail({
          code: "UNKNOWN",
          message:
            "Could not save the API key. Restart the application and try again."
        });
      }
    }
  };
};
