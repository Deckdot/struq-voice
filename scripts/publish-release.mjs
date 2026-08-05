#!/usr/bin/env node
/**
 * publish-release: put a signed release where installed copies look for it,
 * then prove it arrived.
 *
 * NOTHING HERE RE-DERIVES TRUST. The signature was made by sign-release.mjs and
 * checked by verify-release.mjs; this script refuses to upload unless that
 * verifier passes first, and then only moves bytes. It is a courier, not a
 * second opinion, and it deliberately shells out to the real verifier rather
 * than reimplementing the check: a courier that decides for itself whether the
 * cargo is genuine is how an unsigned build reaches a machine.
 *
 * WHAT IT UPLOADS is whatever the build produced, not a hardcoded list. NSIS
 * also emits a .blockmap next to the installer and latest.yml names it;
 * publishing without it makes electron-updater fall back to a full download at
 * best, and 404 mid-update at worst. The set is read from the release
 * directory, with the manifest naming the installer.
 *
 * THE READ-BACK IS THE POINT. Uploading is not publishing. The last thing this
 * does is fetch the manifest back from the feed and assert it names the version
 * just built, because an upload that half-succeeded looks identical to one that
 * worked until a machine tries to update.
 *
 * Run: node scripts/publish-release.mjs [--dir <path>] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { MANIFEST_FILE, releaseDirFrom } from "./lib/release-dir.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const releaseDir = releaseDirFrom(args);

function die(message, hint) {
  console.error(`publish-release: FAIL - ${message}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

const run = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/* 1. Refuse to publish anything the verifier has not passed. Chained rather
      than trusted: `pnpm release` runs the verifier, but this script can be run
      on its own hours later against a directory somebody has since edited.
      Re-running it costs a second. */
console.log("publish-release: verifying the signature before uploading");
try {
  process.stdout.write(
    run(process.execPath, [resolve("scripts/verify-release.mjs"), "--dir", releaseDir])
  );
} catch (error) {
  process.stdout.write(error.stdout ?? "");
  process.stderr.write(error.stderr ?? "");
  die(
    "verify-release did not pass, so nothing was uploaded",
    "Fix the release and re-run `pnpm release`. Publishing an artifact the\nverifier rejects would put a build on the feed that every copy refuses."
  );
}

const manifest = JSON.parse(readFileSync(join(releaseDir, MANIFEST_FILE), "utf8"));
const version = manifest.version;

/* Read from the manifest the verifier just approved, never typed and never
   passed as an argument. That is the whole reason this script exists. */
const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
if (version !== packageVersion) {
  die(`manifest says ${version}, package.json says ${packageVersion}`);
}

/* latest.yml is what electron-updater reads, the .blockmap is what makes a
   delta download possible, and the manifest is what carries the signature. */
const required = ["latest.yml", MANIFEST_FILE, manifest.file];
const assets = readdirSync(releaseDir).filter(
  (name) => required.includes(name) || name.endsWith(".blockmap")
);

for (const name of required) {
  if (!assets.includes(name)) {
    die(
      `the release directory has no ${name}`,
      name === "latest.yml"
        ? "electron-builder writes latest.yml only when a publish provider is\nconfigured. Check the `publish` block in electron-builder.yml."
        : "Rebuild with `pnpm dist` and sign again."
    );
  }
}

const tag = `v${version}`;
console.log(`publish-release: ${dryRun ? "would upload" : "uploading"} ${String(assets.length)} assets to ${tag}`);
for (const name of assets) console.log(`  ${name}`);

if (dryRun) {
  console.log("\npublish-release: dry run, nothing uploaded");
  process.exit(0);
}

try {
  run("gh", ["--version"]);
} catch {
  die(
    "the gh CLI is not available",
    "Install GitHub CLI and run `gh auth login`, or upload the assets in\n" +
      `${releaseDir} to the ${tag} release by hand.`
  );
}

/* Create the release if it does not exist, then upload with --clobber so a
   retry after a partial upload converges rather than erroring on each file
   that already made it. */
let exists = true;
try {
  run("gh", ["release", "view", tag]);
} catch {
  exists = false;
}

if (!exists) {
  run("gh", [
    "release",
    "create",
    tag,
    "--title",
    `Struq Voice ${tag}`,
    "--notes",
    `Signed release ${tag}. Updates are verified against the release key before install.`
  ]);
  console.log(`  created release ${tag}`);
}

run("gh", [
  "release",
  "upload",
  tag,
  ...assets.map((name) => join(releaseDir, name)),
  "--clobber"
]);
console.log("  uploaded");

/* 2. The read-back. An upload that half-succeeded looks exactly like one that
      worked, until a machine tries to update and 404s mid-download. */
console.log("publish-release: reading the manifest back from the feed");
let published;
try {
  const url = run("gh", [
    "release",
    "view",
    tag,
    "--json",
    "assets",
    "--jq",
    `.assets[] | select(.name == "${MANIFEST_FILE}") | .url`
  ]).trim();
  if (!url) die("the manifest is not listed on the release after upload");
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) die(`fetching the published manifest returned ${String(response.status)}`);
  published = await response.json();
} catch (error) {
  die(`could not read the manifest back: ${error.message ?? String(error)}`);
}

if (published.version !== version) {
  die(`the feed serves version ${published.version}, expected ${version}`);
}
if (published.signature !== manifest.signature) {
  die("the published manifest's signature does not match the one just built");
}

console.log("publish-release: OK");
console.log(`  ${tag} is live and serves the signature that was just verified`);
