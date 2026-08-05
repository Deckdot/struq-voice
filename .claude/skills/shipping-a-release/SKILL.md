---
name: shipping-a-release
description: "Cut, sign, verify, publish and push a Struq Voice release with one command. Use whenever asked to 'ship it', 'ship a release', 'release this', 'cut a release', 'publish an update', 'push a new version', 'release the new feature', or any request to get work onto users' machines. Knows the one command to run, what it decides on its own (version bump, release notes), the flags for the cases that differ, and how to recover from a failure at each stage. NOT for building an unsigned local installer (pnpm dist) or for the gates alone (use verification-gates)."
argument-hint: "[--dry-run | --bump patch|minor|major|x.y.z | --skip-gates]"
---

# Shipping a Struq Voice release

## The command

```bash
pnpm release:auto
```

That is the whole thing. It goes from whatever state the working tree is in to
a signed release live on the feed and the tag pushed. **Do not run the
individual steps** (`release:cut`, `ship`, `release:publish`) unless recovering
from a specific failure, see the table at the bottom.

Run it from the repo root, on `main`.

## What it decides, so nobody has to

| Decision | How |
|---|---|
| version bump | Conventional Commits since the last `v*` tag: a breaking change gives major, any `feat:` gives minor, otherwise patch |
| release notes | the same commits, grouped into Breaking / New / Fixed / Other |
| dirty tree | committed as `chore: pre-release working tree` before the cut |
| is it safe | typecheck, lint and unit tests run **before** the version is cut |

The bump rule lives in `src/shared/release-plan.ts` and is unit tested. It is
not duplicated in the script.

## The order, and why it is that order

```
preflight -> read commits -> commit tree -> plan -> GATES -> cut -> build
          -> sign -> verify -> publish -> read back -> push
```

Gates run **before** the cut because the cut is a commit plus a tag. Everything
before it is reversible; everything after it is verified. The irreversible step
sits between a passing suite and a verifier that refuses to publish what it
cannot check.

Preflight fails early on: not a git repo, wrong branch, no `gh`, `gh` not
authenticated, missing signing key. Each of those would otherwise be discovered
*after* a 116MB build.

## Flags

| Flag | When |
|---|---|
| `--dry-run` | rehearse: really builds, signs and verifies, but never commits, tags, uploads or pushes |
| `--bump minor` | override the inferred bump. Also takes an explicit `1.2.3` |
| `--skip-gates` | retry after a failed upload, when the gates already passed minutes ago |
| `--no-commit` | refuse on a dirty tree instead of committing it |
| `--yes` | allow a branch other than `main` |

`pnpm release:dry` is `release:auto --dry-run`.

## Refusals, and what they mean

**"nothing user-facing has changed"** means every commit since the last tag is
`docs:`, `chore:`, `test:`, `style:`, `ci:`, `build:` or `refactor:`. Shipping
would burn a version number on a release whose notes are empty. Override with
`--bump patch` if that is genuinely wanted.

**"on branch X, not main"** means the tag would point at a commit main does not
contain, so the tag and the shipped history would disagree.

**"no signing key"** means the private half is missing. Every installed copy
verifies against the public key it shipped with, so an unsigned release is one
no machine will accept. Restore from backup or set `STRUQ_VOICE_RELEASE_KEY`.

## Recovering from a failure

The script says which stage failed and what to run. In summary:

| Failed at | State | Recovery |
|---|---|---|
| preflight or gates | nothing changed | fix and re-run `pnpm release:auto` |
| gates, after auto-commit | tree committed, not cut | fix, re-run. Or `git reset --soft HEAD~1` to get the changes back |
| build / sign / verify | cut and tagged locally, nothing published | fix, then `pnpm ship` to retry from the existing tag. Or undo: `git tag -d vX.Y.Z && git reset --hard HEAD~1` |
| publish | built and verified, tagged locally | `pnpm release:publish` alone |
| push | **release is already live** | `git push origin main && git push origin vX.Y.Z` |

The one that matters: after a failed **push** the release is live and only the
local repo is behind. Do not re-run `release:auto`, just push.

## Verifying the gate is real

```bash
pnpm release:dry     # build, sign, verify, no side effects
```

To prove the refusal path, flip a byte in the built installer and run
`node scripts/verify-release.mjs`: it must FAIL on hash and signature and exit
1. `src/main/updater.test.ts` covers the in-app refusals (swapped artifact,
downgrade replay, wrong key, tampered signature, unreachable manifest).

## Notes

- The build goes to `%TEMP%/struq-voice-release`, not `release/`. Under
  `Documents` electron-builder's `win-unpacked.tmp` rename hits EPERM.
- The signed message is `<sha512>|<version>`. The version is bound in so a
  genuinely signed older build cannot be replayed as an update.
- Full background in `docs/RELEASING.md`.
