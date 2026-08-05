#!/usr/bin/env node
/**
 * Regenerates the README screenshots in docs/images from the real app.
 *
 * Runs the built app (electron-vite build first) against a throwaway profile
 * so no personal transcript ever lands in a committed image. The profile gets
 * a seeded History and, when this machine has them, junctions to the real
 * model and runtime directories so the readiness states in the shots are the
 * ones a set-up user sees rather than a first-run blank.
 *
 * STRUQ_VOICE_E2E=1 is what makes this safe to run on a working desktop: no
 * keyboard hook, no autostart, and the deliver step is a no-op, so nothing is
 * typed into whatever window happens to be focused.
 *
 * Usage: pnpm docs:shots
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "images");
const profileDir = join(tmpdir(), "struq-voice-docs-profile");
const electronBin = join(root, "node_modules", "electron", "dist", "electron.exe");

/** Retina output. Falls back to 1x if the device metrics override is refused. */
const SCALE = 2;
const WINDOW_WIDTH = 1100;
const WINDOW_HEIGHT = 720;
const OVERLAY_WIDTH = 360;
const OVERLAY_HEIGHT = 88;

/**
 * Transcripts that read like real dictation: varied length, ordinary work
 * sentences, and the kind of names a dictionary entry exists to fix.
 */
const HISTORY = [
  {
    text: "Ship the release notes before the demo, and make sure the installer link points at the signed build rather than the draft.",
    minutesAgo: 4,
    durationMs: 8400,
    inferenceMs: 940
  },
  {
    text: "The paste path is the whole product. If the transcript lands in the wrong window, nothing else about the app matters.",
    minutesAgo: 21,
    durationMs: 7900,
    inferenceMs: 880
  },
  {
    text: "Reminder for tomorrow: walk through the onboarding once on a clean machine and write down every place it asks for something it could have decided itself.",
    minutesAgo: 96,
    durationMs: 10600,
    inferenceMs: 1180
  },
  {
    text: "Add a dictionary entry so Struq stops coming out as struck.",
    minutesAgo: 143,
    durationMs: 3600,
    inferenceMs: 420
  },
  {
    text: "Hey, could you take a look at the pull request when you get a minute? It is only the hotkey capture widget and two tests.",
    minutesAgo: 320,
    durationMs: 7100,
    inferenceMs: 810
  },
  {
    text: "Dictating a commit message is faster than typing one, which is a strange thing to discover about yourself.",
    minutesAgo: 1180,
    durationMs: 6200,
    inferenceMs: 700
  }
];

const settings = {
  version: 1,
  minCaptureMs: 350,
  maxCaptureMs: 120000,
  prerollMs: 250,
  restoreClipboard: true,
  restoreClipboardDelayMs: 400,
  autostart: true,
  pttAccelerator: "CommandOrControl+Space",
  toggleAccelerator: "CommandOrControl+Shift+Space",
  engine: { primary: "parakeet", fallback: null },
  whisperModelId: "whisper-large-v3-turbo-q5_0",
  post: {
    dictionary: [
      { from: "struck", to: "Struq", matchCase: false, wholeWord: true },
      { from: "tow ree", to: "Tauri", matchCase: false, wholeWord: true }
    ],
    removeFillers: true,
    addTrailingPunctuation: false
  },
  onboarding: { completed: true, completedVersion: 1, hardware: null }
};

/**
 * Junction rather than copy: the Parakeet weights are 660MB and the docs run
 * only ever reads them. Missing on this machine is not fatal; the shots then
 * show the not-installed states instead.
 */
const linkRealAssets = () => {
  const appData = process.env["APPDATA"];
  if (appData === undefined) return;
  for (const name of ["models", "runtimes"]) {
    const source = join(appData, "struq-voice", name);
    if (!existsSync(source)) continue;
    try {
      execFileSync("cmd", ["/c", "mklink", "/J", join(profileDir, name), source], {
        stdio: "ignore"
      });
    } catch {
      console.warn(`[shots] Could not link ${name}; states may read as not installed.`);
    }
  }
};

const seedHistory = async () => {
  const now = Date.now();
  const rows = HISTORY.map((entry) => ({
    text: entry.text,
    engineId: "parakeet",
    modelId: "parakeet-tdt-0.6b-v3-int8",
    durationMs: entry.durationMs,
    inferenceMs: entry.inferenceMs,
    costUsd: null,
    language: "en",
    createdAt: now - entry.minutesAgo * 60_000
  }));
  const jsonPath = join(profileDir, "seed.json");
  await writeFile(jsonPath, JSON.stringify(rows));

  // better-sqlite3 is built for the Electron ABI, so the seed runs inside
  // Electron's own Node rather than this process.
  const code = `
    const Database = require("better-sqlite3");
    const { readFileSync } = require("node:fs");
    const db = new Database(process.env.SEED_DB);
    const rows = JSON.parse(readFileSync(process.env.SEED_JSON, "utf8"));
    const insert = db.prepare(
      "INSERT INTO transcripts (text, engine_id, model_id, duration_ms, inference_ms, cost_usd, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    db.transaction((items) => {
      for (const row of items) {
        insert.run(row.text, row.engineId, row.modelId, row.durationMs, row.inferenceMs, row.costUsd, row.language, row.createdAt);
      }
    })(rows);
    db.close();
  `;
  execFileSync(electronBin, ["-e", code], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SEED_DB: join(profileDir, "struq-voice.db"),
      SEED_JSON: jsonPath
    }
  });
};

/**
 * Playwright's screenshot has no upscale option and an Electron window ignores
 * a device-metrics override, so the capture goes through CDP directly: the
 * clip carries the scale, and Chromium re-rasterizes the page at 2x rather
 * than resampling a 1x bitmap.
 */
const retinaShot = async (session, name, width, height, transparent = false) => {
  if (transparent) {
    await session.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 }
    });
  }
  const { data } = await session.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width, height, scale: SCALE },
    captureBeyondViewport: true
  });
  await writeFile(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`[shots] docs/images/${name}.png`);
};

const findWindow = async (app, fragment, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      try {
        if (page.url().includes(fragment)) return page;
      } catch {
        // Still loading.
      }
    }
    await sleep(100);
  }
  throw new Error(`window matching "${fragment}" never appeared`);
};

const goTo = async (page, route) => {
  await page.getByRole("button", { name: route, exact: true }).first().click();
  await sleep(700);
};

const captureState = (app) =>
  app.evaluate(() => globalThis.__struqVoiceTest?.getState() ?? { phase: "unknown" });

const waitForPhase = async (app, phase, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await captureState(app);
    if (state.phase === phase) return state;
    await sleep(40);
  }
  throw new Error(`capture never reached "${phase}"`);
};

await rm(profileDir, { recursive: true, force: true });
await mkdir(profileDir, { recursive: true });
await mkdir(outDir, { recursive: true });
linkRealAssets();
await writeFile(join(profileDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);

// VS Code leaks ELECTRON_RUN_AS_NODE into its terminals, which turns
// electron.exe into plain Node and fails the launch opaquely.
const launchEnv = { ...process.env, STRUQ_VOICE_E2E: "1", STRUQ_VOICE_USERDATA: profileDir };
delete launchEnv["ELECTRON_RUN_AS_NODE"];

const app = await _electron.launch({
  args: ["--headless", "out/main/index.cjs"],
  cwd: root,
  env: launchEnv
});

try {
  const main = await findWindow(app, "/main/");
  await main.waitForLoadState("domcontentloaded");
  const mainSession = await app.context().newCDPSession(main);
  const shoot = (name) => retinaShot(mainSession, name, WINDOW_WIDTH, WINDOW_HEIGHT);

  // The database exists once main has booted, so seeding happens here rather
  // than before launch: no migration SQL is duplicated in this script.
  await seedHistory();
  await sleep(1200);

  await goTo(main, "History");
  await shoot("history");

  await goTo(main, "Models");
  await sleep(1500);
  await shoot("models");

  await goTo(main, "Settings");
  await sleep(400);
  await shoot("settings");

  await main
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Transcription", exact: true })
    .click();
  await sleep(500);
  await shoot("settings-transcription");

  // Dictate remounts, so it picks up the seeded last transcript.
  await goTo(main, "Dictate");
  await sleep(800);
  await shoot("dictate");

  await main.keyboard.press("Control+k");
  await sleep(600);
  await shoot("command-palette");
  await main.keyboard.press("Escape");

  // The overlay is created lazily on the first non-idle state, and the state
  // broadcast that created it went out before its renderer could subscribe.
  // So the first capture only exists to build the window; the second is the
  // one that renders.
  await app.evaluate(() => {
    globalThis.__struqVoiceTest?.drive.start();
  });
  const overlay = await findWindow(app, "/overlay/");
  await overlay.waitForLoadState("domcontentloaded");
  const overlaySession = await app.context().newCDPSession(overlay);
  await sleep(500);
  await app.evaluate(() => {
    globalThis.__struqVoiceTest?.drive.cancel();
  });
  await waitForPhase(app, "idle");

  await app.evaluate(() => {
    globalThis.__struqVoiceTest?.drive.start();
  });
  await waitForPhase(app, "listening");
  await sleep(1400);

  // An empty #root means the overlay entry never mounted, and every pill shot
  // would be a transparent rectangle. Say so rather than writing the file.
  const pillMounted = await overlay.evaluate(
    () => (globalThis.document.getElementById("root")?.children.length ?? 0) > 0
  );
  if (!pillMounted) {
    console.warn("[shots] The overlay pill did not render; skipping its shots.");
  } else {
    await retinaShot(overlaySession, "overlay-listening", OVERLAY_WIDTH, OVERLAY_HEIGHT, true);

    await app.evaluate(() => {
      globalThis.__struqVoiceTest?.drive.stop();
    });
    await waitForPhase(app, "transcribing");
    await retinaShot(overlaySession, "overlay-transcribing", OVERLAY_WIDTH, OVERLAY_HEIGHT, true);

    await waitForPhase(app, "delivering");
    await retinaShot(overlaySession, "overlay-delivering", OVERLAY_WIDTH, OVERLAY_HEIGHT, true);
  }
} finally {
  await app.close();
}

console.log("[shots] Done.");
