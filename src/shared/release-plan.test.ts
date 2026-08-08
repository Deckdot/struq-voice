import { describe, expect, it } from "vitest";
import {
  bumpFor,
  groupForNotes,
  nextVersion,
  parseCommit,
  planRelease,
  type ParsedCommit,
} from "./release-plan";

/** Build a commit list from subject lines, for the cases that do not need bodies. */
const commits = (...subjects: string[]): ParsedCommit[] =>
  subjects.map((subject) => parseCommit(subject));

describe("parseCommit", () => {
  it("reads the type, scope and description", () => {
    const parsed = parseCommit("feat(updater): verify before install");
    expect(parsed.type).toBe("feat");
    expect(parsed.scope).toBe("updater");
    expect(parsed.description).toBe("verify before install");
    expect(parsed.breaking).toBe(false);
  });

  it("reads a type with no scope", () => {
    const parsed = parseCommit("fix: stop the download hanging");
    expect(parsed.type).toBe("fix");
    expect(parsed.scope).toBeNull();
  });

  it("treats a bang as breaking", () => {
    expect(parseCommit("feat!: drop the old config format").breaking).toBe(true);
    expect(parseCommit("feat(config)!: rename every key").breaking).toBe(true);
  });

  it("treats a BREAKING CHANGE footer as breaking", () => {
    const parsed = parseCommit(
      "feat: rework settings",
      "Some context.\n\nBREAKING CHANGE: the settings file moved.",
    );
    expect(parsed.breaking).toBe(true);
  });

  it("accepts the hyphenated BREAKING-CHANGE spelling", () => {
    const parsed = parseCommit("feat: rework", "BREAKING-CHANGE: moved.");
    expect(parsed.breaking).toBe(true);
  });

  it("reports a non-conventional subject as having no type", () => {
    // This matters: it must not parse "WIP" as a type and get treated as a
    // known non-releasing kind of change.
    const parsed = parseCommit("WIP fix stuff");
    expect(parsed.type).toBeNull();
    expect(parsed.description).toBe("WIP fix stuff");
  });

  it("lowercases the type so Feat and feat agree", () => {
    expect(parseCommit("Feat: add a thing").type).toBe("feat");
  });
});

describe("bumpFor", () => {
  it("is patch for fixes alone", () => {
    expect(bumpFor(commits("fix: a", "fix: b"))).toBe("patch");
  });

  it("is minor when a feature is present", () => {
    expect(bumpFor(commits("fix: a", "feat: b"))).toBe("minor");
  });

  it("is major when anything breaks, even among fixes", () => {
    expect(bumpFor(commits("fix: a", "feat!: b", "fix: c"))).toBe("major");
  });

  it("is patch for an empty list", () => {
    expect(bumpFor([])).toBe("patch");
  });
});

describe("planRelease", () => {
  it("refuses to call an empty set releasable", () => {
    const plan = planRelease([]);
    expect(plan.releasable).toBe(false);
    expect(plan.bump).toBe("patch");
    expect(plan.reason).toContain("no commits");
  });

  it("refuses to call a docs-only set releasable", () => {
    const plan = planRelease(commits("docs: runbook", "chore: ignore output", "test: cover ui"));
    expect(plan.releasable).toBe(false);
    expect(plan.bump).toBe("patch");
  });

  it("counts a fix as releasable", () => {
    const plan = planRelease(commits("docs: notes", "fix: stop the hang"));
    expect(plan.releasable).toBe(true);
    expect(plan.bump).toBe("patch");
  });

  it("counts a non-conventional commit as releasable", () => {
    // An unparseable subject could be anything, so it must not be filtered out
    // as invisible. Guessing "probably a chore" is how a real change ships
    // inside a release that claims to contain nothing.
    const plan = planRelease(commits("rename the widget"));
    expect(plan.releasable).toBe(true);
  });

  it("explains a minor by counting the features", () => {
    const plan = planRelease(commits("feat: a", "feat: b", "fix: c"));
    expect(plan.bump).toBe("minor");
    expect(plan.reason).toBe("2 features and no breaking changes");
  });

  it("explains a major by naming the breaking commit", () => {
    const plan = planRelease(commits("fix: a", "feat!: drop old config"));
    expect(plan.bump).toBe("major");
    expect(plan.reason).toContain("drop old config");
  });

  it("uses the singular for one feature", () => {
    expect(planRelease(commits("feat: a")).reason).toBe("1 feature and no breaking changes");
  });
});

describe("nextVersion", () => {
  it("bumps each position and zeroes the ones below", () => {
    expect(nextVersion("1.4.2", "patch")).toBe("1.4.3");
    expect(nextVersion("1.4.2", "minor")).toBe("1.5.0");
    expect(nextVersion("1.4.2", "major")).toBe("2.0.0");
  });

  it("moves off 0.0.0", () => {
    expect(nextVersion("0.0.0", "patch")).toBe("0.0.1");
    expect(nextVersion("0.0.0", "minor")).toBe("0.1.0");
  });

  it("does not stringify a two-digit component wrongly", () => {
    expect(nextVersion("0.9.9", "minor")).toBe("0.10.0");
    expect(nextVersion("0.10.0", "patch")).toBe("0.10.1");
  });

  it("throws on anything that is not x.y.z", () => {
    expect(() => nextVersion("1.2", "patch")).toThrow(/semver/);
    expect(() => nextVersion("v1.2.3", "patch")).toThrow(/semver/);
    expect(() => nextVersion("1.2.3-beta", "patch")).toThrow(/semver/);
  });
});

describe("groupForNotes", () => {
  it("orders sections new, fixed, other", () => {
    const sections = groupForNotes(commits("chore: tidy", "fix: b", "feat: a"));
    expect(sections.map((section) => section.heading)).toEqual(["New", "Fixed", "Other"]);
  });

  it("puts breaking changes first and only once", () => {
    const sections = groupForNotes(commits("feat!: break", "feat: add"));
    expect(sections[0]?.heading).toBe("Breaking changes");
    // The breaking feat must not also appear under New.
    expect(sections[1]?.items).toHaveLength(1);
    expect(sections[1]?.items[0]?.description).toBe("add");
  });

  it("omits empty sections", () => {
    const sections = groupForNotes(commits("fix: a"));
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe("Fixed");
  });

  it("returns nothing for no commits", () => {
    expect(groupForNotes([])).toHaveLength(0);
  });
});
