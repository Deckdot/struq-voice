/**
 * Rebuild native modules against the pinned Electron runtime.
 *
 * Ported from StruqADE/scripts/rebuild-native-modules.mjs. Every module is
 * handled only if it is actually installed, and every failure degrades with a
 * warning instead of failing the install: a native module problem must never
 * prevent the app from booting.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ELECTRON_VERSION = "39.1.2";

const findPnpmStore = (startDir) => {
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, "node_modules", ".pnpm");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `[native] Could not find node_modules/.pnpm from ${startDir}. Run pnpm install from the workspace root first.`,
      );
    }
    current = parent;
  }
};

const pnpmStore = findPnpmStore(process.cwd());
console.log(`[native] Using pnpm store at ${pnpmStore}`);

const findInStore = (folder) => {
  try {
    for (const entry of readdirSync(pnpmStore)) {
      if (!entry.startsWith(`${folder}@`)) continue;
      const candidate = join(pnpmStore, entry, "node_modules", folder);
      try {
        if (statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const betterSqliteDir = findInStore("better-sqlite3");
if (betterSqliteDir !== undefined) {
  console.log(`[native] Fetching Electron ${ELECTRON_VERSION} prebuild for better-sqlite3...`);
  try {
    execFileSync(
      "npm",
      ["exec", "--", "prebuild-install", "--runtime", "electron", "--target", ELECTRON_VERSION],
      { cwd: betterSqliteDir, stdio: "inherit", shell: true },
    );
  } catch {
    console.warn(
      "[native] WARNING: better-sqlite3 prebuild fetch failed. History will be unavailable until it is fixed. Retry with: pnpm rebuild better-sqlite3",
    );
  }
}

const uiohookDir = findInStore("uiohook-napi");
if (uiohookDir !== undefined) {
  console.log(`[native] Building uiohook-napi for Electron ${ELECTRON_VERSION}...`);
  try {
    execFileSync(
      "npx",
      [
        "node-gyp",
        "rebuild",
        "--release",
        `--target=${ELECTRON_VERSION}`,
        "--runtime=electron",
        "--dist-url=https://electronjs.org/headers",
      ],
      { cwd: uiohookDir, stdio: "inherit", shell: true },
    );
  } catch {
    console.warn(
      "[native] WARNING: uiohook-napi build failed. Press-and-hold will be disabled; the toggle shortcut keeps working. Retry with: pnpm rebuild uiohook-napi",
    );
  }
}

console.log("[native] Native module rebuild complete.");
