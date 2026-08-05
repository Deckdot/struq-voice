import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright";

export interface Harness {
  readonly app: ElectronApplication;
  readonly window: Page;
  readonly consoleErrors: string[];
  close: () => Promise<void>;
}

export interface LaunchOverrides {
  readonly [key: string]: string;
}

/**
 * Launch the built app under test. Requires `electron-vite build` first, so
 * e2e always runs as: `electron-vite build && playwright test`.
 *
 * VS Code leaks ELECTRON_RUN_AS_NODE=1 into every terminal it spawns, which
 * turns electron.exe into plain Node and rejects Playwright's Chromium switch
 * with an opaque "Process failed to launch!" error. Strip it here.
 */
export async function launchApp(overrides: LaunchOverrides = {}): Promise<Harness> {
  const consoleErrors: string[] = [];

  const { ELECTRON_RUN_AS_NODE: _drop, ...parentEnv } = process.env;

  // Fresh userData per launch: tests never touch the real profile.
  const userData = mkdtempSync(join(tmpdir(), "struq-voice-e2e-"));

  const app = await _electron.launch({
    args: ["out/main/index.cjs"],
    env: {
      ...(parentEnv as Record<string, string>),
      STRUQ_VOICE_E2E: "1",
      STRUQ_VOICE_ENGINE: "mock",
      STRUQ_VOICE_USERDATA: userData,
      ...overrides,
    },
  });

  const window = await app.firstWindow();
  window.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  window.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  return {
    app,
    window,
    consoleErrors,
    close: async () => {
      await app.close();
    },
  };
}
