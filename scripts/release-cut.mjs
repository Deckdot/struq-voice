#!/usr/bin/env node
/**
 * release-cut: bump the version and tag it, before anything is built.
 *
 * The version is what the signature binds against, so it has to be settled
 * before the installer exists. Bumping after a build would sign an artifact
 * whose embedded version disagrees with the manifest, and verify-release would
 * reject it, correctly and confusingly.
 *
 * Refuses on a dirty tree. A release built from uncommitted work cannot be
 * reproduced from the tag, which makes "which build is on that machine" an
 * unanswerable question exactly when someone is asking it.
 *
 * Run: node scripts/release-cut.mjs <patch|minor|major|x.y.z> [--no-tag]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const bump = args[0];
const noTag = args.includes("--no-tag");

function die(message, hint) {
  console.error(`release-cut: FAIL - ${message}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

const run = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

if (!bump) {
  die(
    "no version given",
    "Usage: node scripts/release-cut.mjs <patch|minor|major|x.y.z> [--no-tag]"
  );
}

let status;
try {
  status = run("git", ["status", "--porcelain"]);
} catch (error) {
  die(`git status failed: ${error.message}`);
}
if (status.length > 0) {
  die(
    "the working tree is dirty",
    [
      "Commit or stash first. A release built from uncommitted work cannot be",
      "rebuilt from its tag, so nobody can later answer what is on a machine.",
      "",
      status
    ].join("\n")
  );
}

const packagePath = resolve("package.json");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const current = pkg.version;

const parse = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) die(`"${value}" is not a semver x.y.z version`);
  return match.slice(1, 4).map(Number);
};

let next;
if (bump === "patch" || bump === "minor" || bump === "major") {
  const [major, minor, patch] = parse(current);
  if (bump === "major") next = `${String(major + 1)}.0.0`;
  else if (bump === "minor") next = `${String(major)}.${String(minor + 1)}.0`;
  else next = `${String(major)}.${String(minor)}.${String(patch + 1)}`;
} else {
  parse(bump);
  next = bump;
}

const [cm, cn, cp] = parse(current);
const [nm, nn, np] = parse(next);
// A feed serves one latest.yml, so going backwards would offer every installed
// copy a downgrade, which the signature check then refuses as a replay.
if (nm * 1e6 + nn * 1e3 + np <= cm * 1e6 + cn * 1e3 + cp) {
  die(`${next} is not newer than the current ${current}`);
}

pkg.version = next;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

run("git", ["add", "package.json"]);
run("git", ["commit", "-m", `chore: release v${next}`]);
if (!noTag) run("git", ["tag", "-a", `v${next}`, "-m", `Struq Voice v${next}`]);

console.log(`release-cut: OK  ${current} -> ${next}`);
console.log(`  committed  chore: release v${next}`);
if (!noTag) console.log(`  tagged     v${next}`);
console.log(`\nNext: pnpm ship`);
