/**
 * Deciding what a release is, from the commits that are in it.
 *
 * WHY THIS IS A MODULE AND NOT A FEW LINES IN THE SCRIPT: this is the only
 * part of shipping that makes a judgement call. Everything downstream is
 * mechanical (hash these bytes, sign that message, upload those files, read it
 * back), and mechanical steps fail loudly when they are wrong. A bump chosen
 * wrongly fails silently: the release works, and the version number quietly
 * stops meaning anything. So the decision lives here, under typecheck and
 * tests, rather than in an untested .mjs that nobody reads twice.
 *
 * THE RULE, in the order it is applied:
 *
 *   breaking change   -> major   ("!" after the type, or a BREAKING CHANGE footer)
 *   any feat:         -> minor
 *   anything else     -> patch
 *
 * That is Conventional Commits, which is already how this repo writes history,
 * so the version number ends up derived from what was actually done rather
 * than from whoever last typed a word at a prompt.
 *
 * NON-RELEASING COMMITS DO NOT COUNT. `docs:`, `chore:`, `test:`, `style:`,
 * `ci:` and `build:` describe work that no installed copy can observe. A run
 * where those are the ONLY commits still produces a patch (see `bumpFor`), but
 * `releasable` reports false so the caller can say "nothing user-facing here"
 * instead of shipping a version whose changelog is empty.
 */

/** How much of the version to move. */
export type Bump = "major" | "minor" | "patch";

/** One parsed commit subject. */
export interface ParsedCommit {
  /** The conventional type, lowercased: "feat", "fix", "docs". Null if the subject is not conventional. */
  readonly type: string | null;
  /** The scope in parentheses, if any: `feat(updater):` gives "updater". */
  readonly scope: string | null;
  /** True when the subject carries `!` or the body has a BREAKING CHANGE footer. */
  readonly breaking: boolean;
  /** The description after the type and colon, or the whole subject when not conventional. */
  readonly description: string;
  /** The raw subject line, unmodified. */
  readonly subject: string;
}

/** What a release would be, given a set of commits. */
export interface ReleasePlan {
  readonly bump: Bump;
  /** False when every commit is docs/chore/test-shaped, so nothing user-facing changed. */
  readonly releasable: boolean;
  /** Why this bump, in one line, for printing before anything irreversible happens. */
  readonly reason: string;
  readonly commits: readonly ParsedCommit[];
}

/**
 * Types whose changes no installed copy can observe. A release containing only
 * these is legal but pointless, and saying so is more useful than shipping it.
 */
const INVISIBLE_TYPES = new Set(["docs", "chore", "test", "style", "ci", "build", "refactor"]);

/**
 * `type(scope)!: description`. The scope and the bang are both optional, and
 * the type is letters only, so a subject like "WIP: fix stuff" does not parse
 * as the type "WIP" and get treated as conventional.
 */
const CONVENTIONAL = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i;

/**
 * Parse one commit. `body` is optional and only consulted for the breaking
 * change footer, which is the half of the convention that does not live in the
 * subject line.
 */
export function parseCommit(subject: string, body = ""): ParsedCommit {
  const trimmed = subject.trim();
  const match = CONVENTIONAL.exec(trimmed);

  // The footer is the other way to declare a break, and it is the one used
  // when the explanation does not fit in a subject line.
  const footerBreaking = /^BREAKING[ -]CHANGE:/m.test(body);

  if (!match) {
    return {
      type: null,
      scope: null,
      breaking: footerBreaking,
      description: trimmed,
      subject: trimmed,
    };
  }

  const [, type, scope, bang, description] = match;
  return {
    type: (type ?? "").toLowerCase(),
    scope: scope ?? null,
    breaking: bang === "!" || footerBreaking,
    description: description ?? "",
    subject: trimmed,
  };
}

/**
 * The bump for a set of commits. Highest wins: one breaking change in a stack
 * of fixes is still a major, because the break is what a user hits.
 */
export function bumpFor(commits: readonly ParsedCommit[]): Bump {
  if (commits.some((commit) => commit.breaking)) return "major";
  if (commits.some((commit) => commit.type === "feat")) return "minor";
  return "patch";
}

/**
 * The whole decision, with the sentence explaining it.
 *
 * An EMPTY commit list is a patch that is not releasable. That combination is
 * deliberate: re-shipping the current version is a real thing to want after a
 * failed upload, so the bump stays valid, but nothing here will claim there
 * were changes when there were none.
 */
export function planRelease(commits: readonly ParsedCommit[]): ReleasePlan {
  const bump = bumpFor(commits);

  if (commits.length === 0) {
    return {
      bump,
      releasable: false,
      reason: "no commits since the last release",
      commits,
    };
  }

  const breaking = commits.filter((commit) => commit.breaking);
  const feats = commits.filter((commit) => commit.type === "feat");
  const visible = commits.filter(
    (commit) => commit.type === null || !INVISIBLE_TYPES.has(commit.type),
  );

  let reason: string;
  if (breaking.length > 0) {
    const first = breaking[0];
    reason = `${String(breaking.length)} breaking change${breaking.length === 1 ? "" : "s"}, starting with "${first?.subject ?? ""}"`;
  } else if (feats.length > 0) {
    reason = `${String(feats.length)} feature${feats.length === 1 ? "" : "s"} and no breaking changes`;
  } else if (visible.length > 0) {
    reason = `${String(visible.length)} fix${visible.length === 1 ? "" : "es"}, no features`;
  } else {
    reason = "only docs, chores and tests since the last release";
  }

  return {
    bump,
    releasable: visible.length > 0,
    commits,
    reason,
  };
}

/** Apply a bump to an x.y.z version. Throws on anything that is not semver. */
export function nextVersion(current: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.trim());
  if (!match) throw new Error(`"${current}" is not a semver x.y.z version`);

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (bump === "major") return `${String(major + 1)}.0.0`;
  if (bump === "minor") return `${String(major)}.${String(minor + 1)}.0`;
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

/**
 * Group commits by type for release notes, in the order a reader cares about:
 * what is new, what is fixed, then everything else.
 */
export function groupForNotes(
  commits: readonly ParsedCommit[],
): readonly { readonly heading: string; readonly items: readonly ParsedCommit[] }[] {
  const sections: { heading: string; types: string[] }[] = [
    { heading: "Breaking changes", types: [] },
    { heading: "New", types: ["feat"] },
    { heading: "Fixed", types: ["fix", "perf"] },
    { heading: "Other", types: [] },
  ];

  const breaking = commits.filter((commit) => commit.breaking);
  const rest = commits.filter((commit) => !commit.breaking);

  const isNew = (commit: ParsedCommit): boolean => commit.type === "feat";
  const isFix = (commit: ParsedCommit): boolean =>
    commit.type === "fix" || commit.type === "perf";

  const grouped = [
    { heading: sections[0]?.heading ?? "Breaking changes", items: breaking },
    { heading: sections[1]?.heading ?? "New", items: rest.filter(isNew) },
    { heading: sections[2]?.heading ?? "Fixed", items: rest.filter(isFix) },
    {
      heading: sections[3]?.heading ?? "Other",
      items: rest.filter((commit) => !isNew(commit) && !isFix(commit)),
    },
  ];

  return grouped.filter((section) => section.items.length > 0);
}
