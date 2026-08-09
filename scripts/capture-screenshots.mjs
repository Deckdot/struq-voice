#!/usr/bin/env node
/**
 * Regenerates the README screenshots in docs/images from the real app.
 *
 * Runs the built app (electron-vite build first) against a throwaway profile
 * so no personal transcript ever lands in a committed image. The profile gets
 * a seeded History, one finished Meeting, a populated Dictionary and, when this
 * machine has them, junctions to the real model and runtime directories so the
 * readiness states in the shots are the ones a set-up user sees rather than a
 * first-run blank.
 *
 * STRUQ_VOICE_E2E=1 is what makes this safe to run on a working desktop: no
 * keyboard hook, no autostart, and the deliver step is a no-op, so nothing is
 * typed into whatever window happens to be focused.
 *
 * Usage: pnpm docs:shots
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
/** Must track OVERLAY_WIDTH and OVERLAY_HEIGHT_COMPACT in overlay-window.ts:
 *  a clip larger than the pill pads every shot with dead transparent margin. */
const OVERLAY_WIDTH = 280;
const OVERLAY_HEIGHT = 48;

/** captureLevelsChangedChannel in src/shared/ipc.ts, which this plain-Node
 *  script cannot import. Asserted against that file before the run. */
const captureLevelsChangedChannel = "capture:levels-changed";

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

/**
 * One finished meeting, seeded so the Meetings view photographs as a library
 * with a transcript in it rather than as an empty state. The microphone lane is
 * always the speaker "me"; the system lane is clustered, which is why the other
 * two speakers carry cluster keys and renamed labels.
 */
const MEETING = {
  title: "Release review",
  minutesAgo: 52,
  durationMs: 1_566_000,
  speakers: [
    { speakerKey: "me", label: "Me" },
    { speakerKey: "s1", label: "Priya" },
    { speakerKey: "s2", label: "Tom" }
  ],
  segments: [
    {
      startMs: 12_400,
      endMs: 19_800,
      source: "system",
      speakerKey: "s1",
      text: "Before we cut the build, can we agree on what actually blocks the release and what is just noise on the board?"
    },
    {
      startMs: 20_600,
      endMs: 28_900,
      source: "mic",
      speakerKey: "me",
      text: "Two things block it. The installer has to be signed, and the update check has to fail closed rather than warn and continue."
    },
    {
      startMs: 29_500,
      endMs: 36_100,
      source: "system",
      speakerKey: "s2",
      text: "The fail closed part is already in. I rewrote the verifier so a bad signature aborts the install instead of logging."
    },
    {
      startMs: 37_000,
      endMs: 44_800,
      source: "system",
      speakerKey: "s1",
      text: "Then the only real blocker is signing, and that is a purchasing question rather than an engineering one."
    },
    {
      startMs: 45_300,
      endMs: 53_700,
      source: "mic",
      speakerKey: "me",
      text: "Agreed. I will write the release notes tonight so the moment the certificate lands we are one command away from shipping."
    },
    {
      startMs: 54_400,
      endMs: 60_200,
      source: "system",
      speakerKey: "s2",
      text: "Send them round before you publish and I will read them on the train in the morning."
    }
  ]
};

const settings = {
  version: 1,
  // Pinned rather than "system": every navigation below finds its view by the
  // English label, so a machine with a non-English Windows language list would
  // otherwise fail the run rather than produce a translated screenshot.
  locale: "en",
  minCaptureMs: 350,
  maxCaptureMs: 300000,
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
      { from: "tow ree", to: "Tauri", matchCase: false, wholeWord: true },
      { from: "at gmail dot com", to: "@gmail.com", matchCase: false, wholeWord: true },
      { from: "Sara", to: "Sarah", matchCase: false, wholeWord: true },
      { from: "post gres", to: "PostgreSQL", matchCase: false, wholeWord: true },
      { from: "kind regards", to: "Kind regards,", matchCase: false, wholeWord: true }
    ],
    removeFillers: true,
    addTrailingPunctuation: false
  },
  onboarding: { completed: true, completedVersion: 1, hardware: null }
};

/**
 * Junction rather than copy: the Parakeet weights alone are 660MB and the docs
 * run only ever reads them. Missing on this machine is not fatal; the shots
 * then show the not-installed states instead, which is why Meetings needs its
 * assets linked too or it photographs as a first-run download screen.
 */
const linkRealAssets = () => {
  const appData = process.env["APPDATA"];
  if (appData === undefined) return;
  for (const name of ["models", "runtimes", "meeting-assets"]) {
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
  const startedAt = now - MEETING.minutesAgo * 60_000;
  const meeting = {
    title: MEETING.title,
    startedAt,
    endedAt: startedAt + MEETING.durationMs,
    durationMs: MEETING.durationMs,
    engineId: "parakeet",
    modelId: "parakeet-tdt-0.6b-v3-int8",
    language: "en",
    speakerCount: MEETING.speakers.length,
    wordCount: MEETING.segments.reduce(
      (total, segment) => total + segment.text.split(/\s+/u).length,
      0
    ),
    state: "complete",
    speakers: MEETING.speakers,
    segments: MEETING.segments.map((segment) => ({
      ...segment,
      createdAt: startedAt + segment.startMs
    }))
  };
  const jsonPath = join(profileDir, "seed.json");
  await writeFile(jsonPath, JSON.stringify({ transcripts: rows, meeting }));

  // better-sqlite3 is built for the Electron ABI, so the seed runs inside
  // Electron's own Node rather than this process.
  const code = `
    const Database = require("better-sqlite3");
    const { readFileSync } = require("node:fs");
    const db = new Database(process.env.SEED_DB);
    const seed = JSON.parse(readFileSync(process.env.SEED_JSON, "utf8"));
    const insert = db.prepare(
      "INSERT INTO transcripts (text, engine_id, model_id, duration_ms, inference_ms, cost_usd, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    db.transaction((items) => {
      for (const row of items) {
        insert.run(row.text, row.engineId, row.modelId, row.durationMs, row.inferenceMs, row.costUsd, row.language, row.createdAt);
      }
    })(seed.transcripts);

    const m = seed.meeting;
    const meetingId = db.prepare(
      "INSERT INTO meetings (title, started_at, ended_at, duration_ms, engine_id, model_id, language, audio_path, audio_bytes, speaker_count, word_count, state) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)"
    ).run(m.title, m.startedAt, m.endedAt, m.durationMs, m.engineId, m.modelId, m.language, m.speakerCount, m.wordCount, m.state).lastInsertRowid;
    const insertSpeaker = db.prepare(
      "INSERT INTO meeting_speakers (meeting_id, speaker_key, label) VALUES (?, ?, ?)"
    );
    const insertSegment = db.prepare(
      "INSERT INTO meeting_segments (meeting_id, start_ms, end_ms, source, speaker_key, text, gap, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)"
    );
    db.transaction(() => {
      for (const s of m.speakers) insertSpeaker.run(meetingId, s.speakerKey, s.label);
      for (const s of m.segments) {
        insertSegment.run(meetingId, s.startMs, s.endMs, s.source, s.speakerKey, s.text, s.createdAt);
      }
    })();
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

/**
 * Under STRUQ_VOICE_E2E the recorder never opens a microphone, so no levels are
 * ever broadcast and the pill photographs as a flat resting line. This pushes a
 * speech-shaped envelope straight down the same channel the recorder would use,
 * so the listening shot shows the waveform a real capture draws. Docs only: the
 * app is untouched, this is the harness standing in for a voice.
 */
const driveLevels = (app, channel) =>
  app.evaluate(
    ({ BrowserWindow }, ch) => {
      const timer = setInterval(() => {
        const t = Date.now() / 1000;
        // Two travelling waves plus a vowel-shaped low-frequency tilt: enough
        // structure to read as speech rather than as a test pattern.
        const bands = Array.from({ length: 32 }, (_, i) => {
          const tilt = Math.exp(-i / 14);
          const wave =
            0.55 * Math.sin(i * 0.55 - t * 7) + 0.45 * Math.sin(i * 0.23 + t * 4.5);
          const envelope = 0.62 + 0.38 * Math.sin(t * 3.1);
          return Math.max(0.04, Math.min(1, (0.45 + 0.4 * wave) * tilt * envelope));
        });
        const level = bands.reduce((sum, b) => sum + b, 0) / bands.length;
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed() && window.webContents.getURL().includes("/overlay/")) {
            window.webContents.send(ch, { bands, level });
          }
        }
      }, 1000 / 60);
      globalThis.__struqDocsLevels = timer;
    },
    channel
  );

const stopLevels = (app) =>
  app.evaluate(() => {
    if (globalThis.__struqDocsLevels !== undefined) {
      clearInterval(globalThis.__struqDocsLevels);
      globalThis.__struqDocsLevels = undefined;
    }
  });

const waitForPhase = async (app, phase, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await captureState(app);
    if (state.phase === phase) return state;
    await sleep(40);
  }
  throw new Error(`capture never reached "${phase}"`);
};

// A renamed channel would otherwise fail silently as a flat waveform rather
// than as an error, so the literal above is checked against its source.
const ipcSource = await readFile(join(root, "src", "shared", "ipc.ts"), "utf8");
if (!ipcSource.includes(`captureLevelsChangedChannel = "${captureLevelsChangedChannel}"`)) {
  throw new Error(
    `captureLevelsChangedChannel is no longer "${captureLevelsChangedChannel}" in src/shared/ipc.ts; update this script.`
  );
}

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
  args: ["out/main/index.cjs"],
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

  // The library list is the shallow half of Meetings. Opening the seeded
  // meeting is what shows the point of the view: a transcript split by speaker.
  await goTo(main, "Meetings");
  await sleep(900);
  await main.getByText(MEETING.title, { exact: true }).first().click();
  await sleep(900);
  await shoot("meetings");

  await goTo(main, "History");
  await shoot("history");

  // An empty sample box reads "0 of 6 rules firing", which is the one state
  // that makes the feature look like it does nothing.
  await goTo(main, "Dictionary");
  await sleep(600);
  await main
    .getByPlaceholder("Type a sentence here to test your rules...")
    .fill("Email Sara at gmail dot com about the struck release, kind regards");
  await sleep(600);
  await shoot("dictionary");

  await goTo(main, "Models");
  await sleep(1500);
  await shoot("models");

  await main.getByRole("button", { name: "PC specs", exact: true }).click();
  await sleep(400);
  await shoot("models-pc-specs");
  await main.getByRole("button", { name: "Done", exact: true }).click();

  await goTo(main, "Settings");
  await sleep(400);
  await shoot("settings");

  await main.getByRole("tab", { name: "Capture", exact: true }).click();
  await sleep(700);
  await shoot("settings-capture");

  await main.getByRole("tab", { name: "Transcription", exact: true }).click();
  await sleep(500);
  await shoot("settings-transcription");

  // Dictate remounts, so it picks up the seeded last transcript.
  await goTo(main, "Dictate");
  await sleep(800);
  await shoot("dictate");

  await main.keyboard.press("Control+f");
  await sleep(600);
  await shoot("command-palette");
  await main.locator(".fixed.inset-0.z-50").click({ position: { x: 8, y: 8 } });
  await sleep(500);

  await goTo(main, "Settings");
  await main.getByRole("tab", { name: "Appearance", exact: true }).click();
  await main.getByRole("tab", { name: "Dark", exact: true }).click();
  await main.bringToFront();
  await sleep(1000);
  await shoot("settings-dark");
  await main.getByRole("tab", { name: "Capture", exact: true }).click();
  await sleep(700);
  await shoot("settings-capture-dark");
  await goTo(main, "Models");
  await shoot("models-dark");

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
  await driveLevels(app, captureLevelsChangedChannel);
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

    // Levels stop with the capture: the transcribing pill is meant to show the
    // waveform decayed into a processing line, not a voice still arriving.
    await stopLevels(app);
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
