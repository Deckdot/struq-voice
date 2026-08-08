#!/usr/bin/env node
/**
 * build-installer: build the NSIS installer into the shared release directory.
 *
 * This exists so the output path is not something anybody has to remember or
 * type. electron-builder stages the unpacked app as `<out>/win-unpacked.tmp`
 * and renames it into place; under Documents on Windows that rename can fail
 * with EPERM, because something holds a handle on a directory of freshly
 * extracted .exe and .dll files. Defender real-time protection is the usual
 * suspect. A workaround that has to be typed on every release is not a fix, so
 * the working path is the default here.
 *
 * The directory is cleared first. A stale installer from a previous version
 * left beside a new one makes sign-release refuse (it will not guess which of
 * two it should sign), and that refusal is right but confusing when the cause
 * is an old file nobody remembered was there.
 *
 * Run: node scripts/build-installer.mjs [--dir <path>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { releaseDirFrom } from "./lib/release-dir.mjs";

const args = process.argv.slice(2);
const releaseDir = releaseDirFrom(args);

function die(message, hint) {
  console.error(`build-installer: FAIL - ${message}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

const run = (cmd, cmdArgs) => {
  execFileSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32" });
};

console.log(`build-installer: output ${releaseDir}`);

if (existsSync(releaseDir)) {
  try {
    rmSync(releaseDir, { recursive: true, force: true });
  } catch (error) {
    die(
      `could not clear ${releaseDir}: ${error.message}`,
      "Close anything holding a file open in that directory and try again."
    );
  }
}
mkdirSync(releaseDir, { recursive: true });

// Before packaging, not after: an installer that shipped without the meeting
// models would gate Meetings behind a download on a machine that just paid
// for a full install.
try {
  run("node", ["scripts/vendor-meeting-assets.mjs"]);
} catch {
  die(
    "could not vendor the meeting support models, so no installer was produced",
    "Check the network, then run node scripts/vendor-meeting-assets.mjs on its own to see which asset failed."
  );
}

try {
  run("pnpm", ["exec", "electron-vite", "build"]);
} catch {
  die("the renderer/main build failed, so no installer was produced");
}

try {
  run("pnpm", [
    "exec",
    "electron-builder",
    "--win",
    "--publish",
    "never",
    "--config.directories.output",
    releaseDir
  ]);
} catch {
  die("electron-builder failed");
}

console.log(`build-installer: OK  installer written to ${releaseDir}`);
