import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const userDataPath = await mkdtemp(path.join(tmpdir(), "struq-voice-smoke-"));
const entryPath = path.resolve("out/main/index.cjs");
const output = [];
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [entryPath], {
  env: {
    ...childEnv,
    STRUQ_VOICE_E2E: "1",
    STRUQ_VOICE_ENGINE: "mock",
    STRUQ_VOICE_START_HIDDEN: "1",
    STRUQ_VOICE_USERDATA: userDataPath,
    STRUQ_VOICE_SMOKE_QUIT: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
  globalThis.setTimeout(() => resolve(null), 10_000);
});

if (result === null && child.pid !== undefined) {
  const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve) => killer.once("exit", resolve));
}

await rm(userDataPath, {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 200,
});

if (result !== null && result.code !== 0) {
  const detail = output.join("").trim();
  throw new Error(
    `Struq Voice exited before the 10 second smoke window (code ${String(result.code)}, signal ${String(result.signal)}).${detail.length > 0 ? `\n${detail}` : ""}`,
  );
}

const detail = output.join("");
if (/Object has been destroyed|uncaught exception|JavaScript error/i.test(detail)) {
  throw new Error(`Struq Voice reported a lifecycle error during boot or quit.\n${detail}`);
}
if (result !== null) {
  console.log("Boot smoke passed: Struq Voice booted and quit gracefully.");
} else {
  console.log("Boot smoke passed: Struq Voice stayed healthy for 10 seconds.");
}
