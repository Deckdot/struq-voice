#!/usr/bin/env node
/**
 * vendor-meeting-assets: fetch the meeting support models into
 * `resources/meeting-assets/` so the installer can ship them.
 *
 * Meetings need three small models beyond the transcription engine. Making the
 * user download them from a card in the app meant explaining what a voice
 * activity detector is, which is not something anybody opened the app to learn.
 * Shipping them in the installer means Meetings simply works after install.
 *
 * Every file is sha256-verified against `src/shared/meeting-assets.ts`, which
 * stays the single source of truth for what the app expects. A hash mismatch
 * fails the build rather than baking a bad file into an installer nobody can
 * repair remotely. Already-correct files are skipped, so re-runs are cheap.
 *
 * Run: node scripts/vendor-meeting-assets.mjs [--force]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const outRoot = join(repoRoot, "resources", "meeting-assets");
const force = process.argv.slice(2).includes("--force");

function die(message, hint) {
  console.error(`vendor-meeting-assets: FAIL - ${message}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

/**
 * Read the asset table out of the TypeScript source rather than duplicating it
 * here. Two lists that must agree eventually disagree, and the one the app
 * reads is the one that matters.
 */
function readAssets() {
  const source = readFileSync(join(repoRoot, "src", "shared", "meeting-assets.ts"), "utf8");
  const assets = [];
  const idPattern = /id:\s*"(meeting-[a-z0-9-]+)"/g;
  let match;
  while ((match = idPattern.exec(source)) !== null) {
    const tail = source.slice(match.index);
    const path = /path:\s*"([^"]+)"/.exec(tail);
    const url = /url:\s*"([^"]+)"/.exec(tail);
    const sha256 = /sha256:\s*"([0-9a-f]{64})"/.exec(tail);
    if (path === null || url === null || sha256 === null) {
      die(`could not parse the file entry for ${match[1]}`);
    }
    assets.push({ id: match[1], path: path[1], url: url[1], sha256: sha256[1] });
  }
  if (assets.length === 0) {
    die("no assets found in src/shared/meeting-assets.ts");
  }
  return assets;
}

const sha256Of = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const assets = readAssets();
console.log(`vendor-meeting-assets: ${String(assets.length)} assets -> ${outRoot}`);

for (const asset of assets) {
  const target = join(outRoot, asset.id, asset.path);
  mkdirSync(dirname(target), { recursive: true });

  if (!force && existsSync(target) && sha256Of(target) === asset.sha256) {
    console.log(`  ok       ${asset.id} (already verified)`);
    continue;
  }

  process.stdout.write(`  fetching ${asset.id} ... `);
  let bytes;
  try {
    const response = await fetch(asset.url);
    if (!response.ok) {
      die(`${asset.id}: HTTP ${String(response.status)} from ${asset.url}`);
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    die(`${asset.id}: ${error.message}`, "Check the network and try again.");
  }

  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== asset.sha256) {
    die(
      `${asset.id}: sha256 mismatch`,
      `expected ${asset.sha256}\nactual   ${actual}\n\nThe upstream file changed. Update src/shared/meeting-assets.ts deliberately rather than trusting this download.`
    );
  }

  // Written beside the target then renamed, so an interrupted run never leaves
  // a half-written file that looks installed.
  const staging = `${target}.partial`;
  writeFileSync(staging, bytes);
  rmSync(target, { force: true });
  renameSync(staging, target);
  console.log(`done (${(bytes.length / 1048576).toFixed(1)} MB)`);
}

console.log("vendor-meeting-assets: OK");
