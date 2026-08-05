import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright";
import type { CaptureState } from "../../src/shared/capture";
import type { TranscriptRecord } from "../../src/shared/ipc";
import type { TestHarnessGlobal } from "../../src/shared/test-hooks";

export interface Harness {
  readonly app: ElectronApplication;
  /** The main window (Struq Voice), not the hidden recorder window. */
  readonly window: Page;
  /** Console errors collected from every window, existing and future. */
  readonly consoleErrors: string[];
  close: () => Promise<void>;
}

export interface LaunchOverrides {
  readonly [key: string]: string;
}

/** Overrides that change how the app is launched, not its env. */
export interface LaunchOptions {
  /** Default true. The hook spec needs real OS focus and key events. */
  readonly headless?: boolean;
}

/**
 * Launch the built app under test. Requires `electron-vite build` first, so
 * e2e always runs as: `electron-vite build && playwright test`.
 *
 * Runs headless (`--headless`): no windows pop up while the suite runs.
 * Headless caveat: BrowserWindow.isVisible() reports false for every window,
 * so specs must not assert visible=true; they assert properties and state
 * transitions instead (a visible=false assertion still holds).
 *
 * VS Code leaks ELECTRON_RUN_AS_NODE=1 into every terminal it spawns, which
 * turns electron.exe into plain Node and rejects Playwright's Chromium switch
 * with an opaque "Process failed to launch!" error. Strip it here.
 */
export async function launchApp(
  overrides: LaunchOverrides = {},
  options: LaunchOptions = {}
): Promise<Harness> {
  const consoleErrors: string[] = [];

  const { ELECTRON_RUN_AS_NODE: _drop, ...parentEnv } = process.env;

  // Fresh userData per launch: tests never touch the real profile.
  const userData = mkdtempSync(join(tmpdir(), "struq-voice-e2e-"));

  const args = [...(options.headless === false ? [] : ["--headless"]), "out/main/index.cjs"];

  const app = await _electron.launch({
    args,
    env: {
      ...(parentEnv as Record<string, string>),
      STRUQ_VOICE_E2E: "1",
      STRUQ_VOICE_ENGINE: "mock",
      STRUQ_VOICE_USERDATA: userData,
      ...overrides
    }
  });

  const attach = (page: Page): void => {
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });
  };

  app.on("window", (page) => {
    attach(page);
  });
  for (const page of app.windows()) {
    attach(page);
  }

  const window = await waitForMainWindow(app);

  return {
    app,
    window,
    consoleErrors,
    close: async () => {
      await app.close();
    }
  };
}

/**
 * Wait for the main window. The app also opens a hidden recorder window, so
 * firstWindow() is not deterministic; the preload exposes windowKind on every
 * window, which is a stable discriminator.
 */
export async function waitForMainWindow(
  app: ElectronApplication,
  timeoutMs = 10_000
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      try {
        const kind = await page.evaluate(
          () =>
            (window as unknown as { struqVoice?: { windowKind?: string } }).struqVoice
              ?.windowKind
        );
        if (kind === "main") return page;
      } catch {
        // Page still loading; try again.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("main window not found within timeout");
}

/**
 * Accessors into the main-process test hook. The evaluate bodies are fully
 * self-contained: closures from the test process do not exist in main.
 */
export const testHook = {
  drive: {
    start: (app: ElectronApplication): Promise<void> =>
      app.evaluate(() => {
        (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.drive.start();
      }),
    stop: (app: ElectronApplication): Promise<void> =>
      app.evaluate(() => {
        (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.drive.stop();
      }),
    cancel: (app: ElectronApplication): Promise<void> =>
      app.evaluate(() => {
        (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.drive.cancel();
      }),
    fail: (app: ElectronApplication, message: string): Promise<void> =>
      app.evaluate((_arg, message: string) => {
        (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.drive.fail(message);
      }, message)
  },
  getState: (app: ElectronApplication): Promise<CaptureState> =>
    app.evaluate(() => {
      const hook = (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest;
      const state = hook?.getState();
      if (state === undefined) throw new Error("test hook state missing");
      return state;
    }),
  history: {
    getRecent: (app: ElectronApplication): Promise<readonly TranscriptRecord[]> =>
      app.evaluate(() => {
        const recent = (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.history.getRecent();
        if (recent === undefined) throw new Error("test hook history missing");
        return recent;
      })
  },
  tray: {
    getMenuItemIds: (app: ElectronApplication): Promise<readonly string[]> =>
      app.evaluate(() => {
        const ids = (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.tray.getMenuItemIds();
        if (ids === undefined) throw new Error("test hook tray missing");
        return ids;
      }),
    getTooltip: (app: ElectronApplication): Promise<string | null> =>
      app.evaluate(
        () =>
          (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.tray.getTooltip() ??
          null
      )
  },
  recorder: {
    isVisible: (app: ElectronApplication): Promise<boolean> =>
      app.evaluate(
        () =>
          (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.recorder.isVisible() ??
          false
      ),
    isLive: (app: ElectronApplication): Promise<boolean> =>
      app.evaluate(
        () =>
          (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.recorder.isLive() ??
          false
      )
  },
  getLastCaptureWav: (
    app: ElectronApplication
  ): Promise<{ base64: string; durationMs: number } | null> =>
    app.evaluate(() => {
      const wav = (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest
        ?.getLastCaptureWav();
      if (wav === undefined) throw new Error("test hook wav missing");
      return wav;
    }),
  keyboard: {
    pressAndHold: (app: ElectronApplication): Promise<void> =>
      app.evaluate(() => {
        (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.keyboard.pressAndHold();
      }),
    releaseHold: (app: ElectronApplication): Promise<void> =>
      app.evaluate(() => {
        (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.keyboard.releaseHold();
      })
  },
  overlay: {
    exists: (app: ElectronApplication): Promise<boolean> =>
      app.evaluate(
        () => (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.overlay.exists() ?? false
      ),
    isVisible: (app: ElectronApplication): Promise<boolean> =>
      app.evaluate(
        () =>
          (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.overlay.isVisible() ??
          false
      ),
    isFocusable: (app: ElectronApplication): Promise<boolean> =>
      app.evaluate(
        () =>
          (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.overlay.isFocusable() ??
          false
      ),
    isSkipTaskbar: (app: ElectronApplication): Promise<boolean> =>
      app.evaluate(
        () =>
          (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.overlay.isSkipTaskbar() ??
          false
      ),
    isAlwaysOnTop: (app: ElectronApplication): Promise<boolean> =>
      app.evaluate(
        () =>
          (globalThis as unknown as TestHarnessGlobal).__struqVoiceTest?.overlay.isAlwaysOnTop() ??
          false
      )
  }
};
