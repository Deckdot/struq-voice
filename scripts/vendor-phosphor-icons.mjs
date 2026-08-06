#!/usr/bin/env node
/**
 * Vendors the Phosphor regular icon subset used by Struq Voice into
 * src/renderer/assets/icons/ph.json, ready to feed iconify's addCollection.
 *
 * The CSP blocks network icon fetching and we want offline-bundled icons
 * anyway, so a curated subset beats shipping the entire ~9k-icon set.
 *
 * Run from the repo root: `node scripts/vendor-phosphor-icons.mjs`.
 * Fails loudly when a name in the whitelist is missing from the source set,
 * printing the first three available names that start with the same letters
 * so a human can pick a near synonym.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const sourcePath = resolve(
  repoRoot,
  "node_modules/@iconify/json/json/ph.json"
);
const outputPath = resolve(
  repoRoot,
  "src/renderer/assets/icons/ph.json"
);

/**
 * The exact icons used across the renderer. Keep this list in lockstep with
 * `src/renderer/main/lib/icons.ts` and the components that reference them.
 * Names are from the Phosphor regular set (ph).
 */
const WHITELIST = [
  "microphone",
  "microphone-slash",
  "wave-sine",
  "gear",
  "clock-counter-clockwise",
  "cube",
  "download-simple",
  "trash",
  "copy",
  "check",
  "check-circle",
  "magnifying-glass",
  "x",
  "caret-right",
  "caret-down",
  "keyboard",
  "warning-circle",
  "info",
  "circle-notch",
  "arrow-clockwise",
  "arrow-right",
  "folder-open",
  "hard-drive",
  "key",
  "sun",
  "moon",
  "circle-half",
  "plus",
  "minus",
  "square",
  "pencil-simple",
  "swap",
  "sliders-horizontal",
  "monitor",
  "clipboard-text",
  "list-checks",
  "eraser",
  "text-t",
  "command",
  "broom"
];

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const available = source.icons;
const missing = WHITELIST.filter((name) => !(name in available));
if (missing.length > 0) {
  const suggestions = missing
    .map((name) => {
      const head = name.slice(0, 3);
      const near = Object.keys(available)
        .filter((entry) => entry.startsWith(head))
        .slice(0, 3);
      return `  ${name}: try ${near.join(", ") || "no suggestions"}`;
    })
    .join("\n");
  throw new Error(
    `Phosphor whitelist references icons missing from @iconify/json:\n${suggestions}`
  );
}

const icons = {};
for (const name of WHITELIST) {
  icons[name] = available[name];
}

const output = {
  prefix: "ph",
  lastModified: source.lastModified,
  icons
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(output));

console.log(
  `Vendored ${WHITELIST.length} Phosphor icons to ${outputPath}`
);
