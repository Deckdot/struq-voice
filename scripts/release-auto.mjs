#!/usr/bin/env node
/**
 * release-auto: the whole release, from a working tree to a live feed, as one
 * command that takes no decisions from whoever runs it.
 *
 * WHAT PROBLEM THIS SOLVES. The pieces underneath (cut, build, sign, verify,
 * publish) were already deterministic. What was not deterministic was the
 * human in front of them: which bump, has the tree been committed, did the
 * gates pass, is this the right branch. Those questions got answered fresh
 * every release, which is exactly the kind of thing that is done well nine
 * times and badly on the tenth, at which point a broken build is on the feed
 * and every installed copy is refusing it.
 *
 * So the decisions are made here, from the repository's own state:
 *
 *   what changed   -> git log since the last tag
 *   which bump     -> Conventional Commits (src/shared/release-plan.ts, tested)
 *   release notes  -> the same commits, grouped
 *   is it safe     -> typecheck, lint and unit tests, before anything is cut
 *
 * THE ORDER IS THE SAFETY PROPERTY. Gates run BEFORE the version is cut,
 * because a cut is a commit and a tag: undoing one means rewriting published
 * history, and the tag may already have been fetched. Everything before the
 * cut is reversible and everything after it is verified, so the irreversible
 * step sits between a passing test suite and a verifier that refuses to
 * publish what it cannot check.
 *
 * IT SHELLS OUT rather than reimplementing. Each underlying script is the
 * authority on its own step, and this one only sequences them and reports.
 * A pipeline that re-derives what its stages already decided is a pipeline
 * with two answers to every question.
 *
 * Run: node scripts/release-auto.mjs [options]
 *
 *   --dry-run          do everything except commit, tag, push and upload
 *   --bump <kind>      override the inferred patch|minor|major|x.y.z
 *   --no-commit        refuse if the tree is dirty instead of committing it
 *   --skip-gates       skip typecheck/lint/test (for a retry after a failed upload)
 *   --yes              do not pause for confirmation
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { parseCommit, planRelease, nextVersion, groupForNotes } = await import(
  pathToFileURL(resolve("src/shared/release-plan.ts")).href
);

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const dryRun = has("dry-run");
const noCommit = has("no-commit");
const skipGates = has("skip-gates");
const assumeYes = has("yes");
const bumpOverride = flag("bump");

/* Written as escapes rather than raw bytes so the file stays plain text. */
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const OFF = "\u001b[0m";

let step = 0;
const total = skipGates ? 5 : 6;

function heading(text) {
  step += 1;
  console.log(`\n${BOLD}[${String(step)}/${String(total)}] ${text}${OFF}`);
}

function die(message, hint) {
  console.error(`\n${RED}release-auto: FAIL - ${message}${OFF}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

/** Capture output. Used for git plumbing, where the output is the answer. */
const capture = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * Stream output. Used for the long steps, where watching it is the point.
 *
 * NO SHELL. `process.execPath` on Windows is under "C:\Program Files", and a
 * shell splits that on the space into a command that does not exist. The only
 * thing here that needs a shell is pnpm, which is a .cmd shim rather than a
 * real executable, so that gets its own helper and nothing else pays for it.
 */
const stream = (cmd, cmdArgs) => {
  execFileSync(cmd, cmdArgs, { stdio: "inherit" });
};

/** Run a pnpm script. Needs a shell on Windows because pnpm is a .cmd shim. */
const pnpm = (script) => {
  execFileSync("pnpm", [script], { stdio: "inherit", shell: process.platform === "win32" });
};

/* ------------------------------------------------------------------ *
 * 0. Preflight. Everything that would make a later step fail halfway.
 * ------------------------------------------------------------------ */

console.log(`${BOLD}release-auto${OFF}${DIM}${dryRun ? "  (dry run, nothing will be published)" : ""}${OFF}`);

try {
  capture("git", ["rev-parse", "--git-dir"]);
} catch {
  die("this is not a git repository");
}

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main" && !assumeYes) {
  die(
    `on branch "${branch}", not main`,
    "A release cut on a side branch tags a commit that main does not contain,\n" +
      "so the tag and the shipped history disagree. Switch to main, or pass\n" +
      "--yes if this branch really is what should ship."
  );
}

/* The publisher needs gh, and finding that out AFTER building a 116MB
   installer and cutting a tag is a bad time to learn it. */
if (!dryRun) {
  try {
    capture("gh", ["--version"]);
  } catch {
    die(
      "the gh CLI is not available, so the release could not be published",
      "Install GitHub CLI and run `gh auth login`. Nothing has been changed."
    );
  }
  try {
    execFileSync("gh", ["auth", "status"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    die("gh is installed but not authenticated", "Run `gh auth login`. Nothing has been changed.");
  }
}

/* The signing key, checked before the build rather than after it. sign-release
   resolves the same three places in the same order; this only asks whether the
   step would find one. */
const keyPath =
  process.env.STRUQ_VOICE_RELEASE_KEY ??
  resolve(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".struq/struq-voice-release-private.pem");
try {
  readFileSync(keyPath);
} catch {
  die(
    `no signing key at ${keyPath}`,
    "Every update is verified against the release key before it installs, so a\n" +
      "release cannot be signed without the private half. Restore it from your\n" +
      "backup, or set STRUQ_VOICE_RELEASE_KEY to where it lives."
  );
}

/* ------------------------------------------------------------------ *
 * 1. What is in this release.
 * ------------------------------------------------------------------ */

heading("Reading what changed");

/* The last release tag, not the last tag of any kind. A tag someone made for
   another reason must not silently become the baseline for a version bump. */
let lastTag = null;
try {
  lastTag = capture("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
} catch {
  lastTag = null;
}

const range = lastTag ? `${lastTag}..HEAD` : "HEAD";

/* Subject and body per commit, split on ASCII record/unit separators. Parsing
   `git log` line by line breaks the moment a commit body contains something
   that looks like a subject, and a body explaining a BREAKING CHANGE is
   exactly where that happens. Not null bytes: execFileSync rejects arguments
   containing them, which fails at the spawn rather than in the parse. */
const SEP = "\u001e";
const FIELD = "\u001f";
let rawLog = "";
try {
  rawLog = capture("git", ["log", range, `--format=%s${FIELD}%b${SEP}`, "--no-merges"]);
} catch (error) {
  die(`could not read the commit log: ${error.message}`);
}

const committedCommits = rawLog
  .split(SEP)
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0)
  .map((entry) => {
    const [subject = "", body = ""] = entry.split(FIELD);
    return parseCommit(subject, body);
  });

console.log(`  since     ${lastTag ?? "the beginning (no release tag yet)"}`);
console.log(`  commits   ${String(committedCommits.length)}`);

/* ------------------------------------------------------------------ *
 * 2. The working tree.
 * ------------------------------------------------------------------ */

heading("Checking the working tree");

const status = capture("git", ["status", "--porcelain"]);
const dirty = status.length > 0;
let autoCommitted = false;

if (dirty) {
  const files = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  console.log(`  ${String(files.length)} uncommitted change${files.length === 1 ? "" : "s"}:`);
  for (const file of files.slice(0, 20)) console.log(`    ${DIM}${file}${OFF}`);
  if (files.length > 20) console.log(`    ${DIM}... and ${String(files.length - 20)} more${OFF}`);

  if (noCommit) {
    die(
      "the working tree is dirty and --no-commit was passed",
      "Commit or stash, then run again."
    );
  }

  if (dryRun) {
    console.log(`  ${YELLOW}would commit these${OFF} (dry run)`);
  } else {
    /* A release built from uncommitted work cannot be rebuilt from its tag,
       which makes "what is on that machine" unanswerable exactly when someone
       is asking. Committing is what keeps the tag meaningful. */
    stream("git", ["add", "-A"]);
    const subject = "chore: pre-release working tree";
    execFileSync("git", ["commit", "-m", subject], { stdio: ["ignore", "pipe", "pipe"] });
    autoCommitted = true;
    committedCommits.push(parseCommit(subject));
    console.log(`  ${GREEN}committed${OFF} as "${subject}"`);
  }
} else {
  console.log(`  ${GREEN}clean${OFF}`);
}

/* ------------------------------------------------------------------ *
 * 3. The plan.
 * ------------------------------------------------------------------ */

heading("Planning the version");

const plan = planRelease(committedCommits);
const pkgPath = resolve("package.json");
const currentVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version;

let bump = plan.bump;
let target;
if (bumpOverride) {
  if (/^\d+\.\d+\.\d+$/.test(bumpOverride)) {
    target = bumpOverride;
    bump = "explicit";
  } else if (["patch", "minor", "major"].includes(bumpOverride)) {
    bump = bumpOverride;
    target = nextVersion(currentVersion, bump);
  } else {
    die(`--bump "${bumpOverride}" is not patch, minor, major or x.y.z`);
  }
} else {
  target = nextVersion(currentVersion, bump);
}

console.log(`  current   ${currentVersion}`);
console.log(`  bump      ${BOLD}${bump}${OFF}${bumpOverride ? `  ${DIM}(overridden)${OFF}` : `  ${DIM}${plan.reason}${OFF}`}`);
console.log(`  next      ${BOLD}${GREEN}${target}${OFF}`);

if (!plan.releasable && !bumpOverride) {
  die(
    `nothing user-facing has changed since ${lastTag ?? "the start"}`,
    "Every commit is docs, chore or test shaped, so a release would ship a\n" +
      "version number and no change anybody can observe. Pass --bump patch if\n" +
      "you want to ship it anyway."
  );
}

const sections = groupForNotes(committedCommits);
if (sections.length > 0) {
  console.log("");
  for (const section of sections) {
    console.log(`  ${BOLD}${section.heading}${OFF}`);
    for (const commit of section.items) {
      const scope = commit.scope ? `${commit.scope}: ` : "";
      console.log(`    ${DIM}-${OFF} ${scope}${commit.description}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 4. Gates. Before the cut, because the cut is the irreversible step.
 * ------------------------------------------------------------------ */

if (!skipGates) {
  heading("Running the gates");
  for (const gate of ["typecheck", "lint", "test"]) {
    process.stdout.write(`  ${gate} ... `);
    try {
      execSync(`pnpm ${gate}`, { stdio: ["ignore", "pipe", "pipe"] });
      console.log(`${GREEN}pass${OFF}`);
    } catch (error) {
      console.log(`${RED}FAIL${OFF}\n`);
      process.stdout.write(String(error.stdout ?? ""));
      process.stderr.write(String(error.stderr ?? ""));
      die(
        `${gate} failed, so nothing was cut or published`,
        autoCommitted
          ? "Note: the working tree was committed before this ran. Fix the failure\n" +
              "and run again, or `git reset --soft HEAD~1` to get the changes back."
          : "Fix the failure and run again. Nothing has been cut."
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * 5. Cut.
 * ------------------------------------------------------------------ */

heading(`Cutting v${target}`);

if (dryRun) {
  console.log(`  ${YELLOW}would run${OFF} release-cut ${target}`);
} else {
  try {
    stream(process.execPath, [resolve("scripts/release-cut.mjs"), target]);
  } catch {
    die("release-cut failed, so nothing was built or published");
  }
}

/* ------------------------------------------------------------------ *
 * 6. Build, sign, verify, publish.
 * ------------------------------------------------------------------ */

heading(dryRun ? "Building, signing and verifying" : "Building, signing, verifying and publishing");

if (dryRun) {
  /* A dry run still builds and verifies. A "dry run" that skips the only steps
     that can fail slowly would report success for a release that cannot be
     produced, which is worse than not offering one. */
  try {
    pnpm("release");
    stream(process.execPath, [resolve("scripts/publish-release.mjs"), "--dry-run"]);
  } catch {
    die("the build/sign/verify chain failed");
  }
  console.log(`\n${YELLOW}release-auto: dry run complete${OFF}`);
  console.log(`  ${target} was built, signed and verified. Nothing was cut, tagged or uploaded.`);
  console.log(`\n  ${DIM}Note: package.json still says ${currentVersion}; the installer was built from it.${OFF}`);
  process.exit(0);
}

try {
  pnpm("release");
} catch {
  die(
    "the build/sign/verify chain failed after the version was cut",
    `v${target} is committed and tagged locally but nothing was published.\n` +
      "Fix the failure, then run `pnpm ship` to retry from the existing tag,\n" +
      `or undo with: git tag -d v${target} && git reset --hard HEAD~1`
  );
}

try {
  stream(process.execPath, [resolve("scripts/publish-release.mjs")]);
} catch {
  die(
    "publishing failed",
    `The release is built, signed and verified, and v${target} is tagged\n` +
      "locally. Retry the upload alone with `pnpm release:publish`."
  );
}

/* Push last. The tag is what makes a published release reproducible, so it
   goes up only once there is something on the feed for it to correspond to. */
heading("Pushing the commit and tag");
try {
  stream("git", ["push", "origin", branch]);
  stream("git", ["push", "origin", `v${target}`]);
  console.log(`  ${GREEN}pushed${OFF} ${branch} and v${target}`);
} catch {
  console.error(
    `\n${YELLOW}release-auto: the release is live but the push failed.${OFF}\n` +
      `  Run: git push origin ${branch} && git push origin v${target}`
  );
  process.exit(1);
}

console.log(`\n${GREEN}${BOLD}release-auto: OK${OFF}`);
console.log(`  ${BOLD}v${target}${OFF} is live, signed, verified and pushed.`);
console.log(`  ${DIM}Installed copies will offer it on their next check.${OFF}`);
