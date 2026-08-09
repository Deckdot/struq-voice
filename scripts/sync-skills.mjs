#!/usr/bin/env node
/**
 * Mirrors `.claude/skills/` into `.agents/skills/`.
 *
 * Two directories hold the same skills because different harnesses look in
 * different places. Keeping them in sync by hand does not work: this script
 * was written after `shipping-a-release` had existed in `.claude/skills/` for
 * some time while `.agents/skills/` did not have it at all, which meant any
 * non-Claude agent silently could not see the release SOP.
 *
 * `.claude/skills/` is canonical. Edit there; never edit the mirror.
 *
 * Usage:
 *   node scripts/sync-skills.mjs           copy canonical over the mirror
 *   node scripts/sync-skills.mjs --check   report drift, exit 1 if any
 *
 * `--check` is what CI runs, so a drifted mirror fails the build rather than
 * being discovered months later by an agent that behaved oddly.
 */

import { readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, ".claude", "skills");
const target = join(root, ".agents", "skills");
const checkOnly = process.argv.includes("--check");

/** Every file under dir, as paths relative to it, sorted for stable output. */
const listFiles = async (dir) => {
  const found = [];
  const walk = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        found.push(relative(dir, full).split("\\").join("/"));
      }
    }
  };
  await walk(dir);
  return found.sort();
};

const sourceFiles = await listFiles(source);
if (sourceFiles.length === 0) {
  console.error(`[skills] No skills found in ${relative(root, source)}.`);
  process.exit(1);
}
const targetFiles = await listFiles(target);

const missing = sourceFiles.filter((file) => !targetFiles.includes(file));
const extra = targetFiles.filter((file) => !sourceFiles.includes(file));

// Compared as bytes rather than mtimes: a copy updates the timestamp even
// when the content is identical, which would report drift on every run.
const differing = [];
for (const file of sourceFiles) {
  if (missing.includes(file)) continue;
  const [a, b] = await Promise.all([
    readFile(join(source, file)),
    readFile(join(target, file))
  ]);
  if (!a.equals(b)) differing.push(file);
}

if (checkOnly) {
  const drifted = missing.length + extra.length + differing.length;
  if (drifted === 0) {
    console.log(`[skills] In sync: ${String(sourceFiles.length)} files.`);
    process.exit(0);
  }
  for (const file of missing) console.error(`[skills] missing from mirror: ${file}`);
  for (const file of extra) console.error(`[skills] only in mirror: ${file}`);
  for (const file of differing) console.error(`[skills] content differs: ${file}`);
  console.error(
    `\n[skills] ${String(drifted)} file(s) out of sync. Edit .claude/skills/ and run: pnpm skills:sync`
  );
  process.exit(1);
}

for (const file of extra) {
  await rm(join(target, file));
  console.log(`[skills] removed ${file}`);
}
for (const file of sourceFiles) {
  const destination = join(target, file);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(join(source, file)));
}
console.log(
  `[skills] Mirrored ${String(sourceFiles.length)} file(s) to ${relative(root, target)}.`
);
