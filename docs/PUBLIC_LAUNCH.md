# Public launch plan

Taking `Deckdot/struq-voice` from a private repository to a public, promotable
open-source project. Written 2026-08-09 against v0.5.0.

The companion marketing site (`Deckdot/StruqVoiceSite`) stays private. Only this
repository is published.

Decisions locked before writing this plan:

- **License: MIT.** Maximum adoption, minimum friction.
- **Windows 10 and 11, 64-bit.** Relabel now on dependency analysis, without a
  Win10 test pass first.
- **Standard community set.** License, security policy, issue and PR templates,
  and CI. No CONTRIBUTING or code of conduct yet.

## Execution status

Implemented on 2026-08-09:

- MIT licensing, repository cleanup, community health files, and Windows CI.
- Windows 10 and 11 labelling, x64 startup enforcement, and actionable meeting
  loopback failures.
- Five-minute default dictation captures, with the existing ten-minute setting
  ceiling preserved.
- A risk-based test audit, deterministic concurrency coverage, coverage tooling,
  and a documented testing policy. The focused suite contains 437 tests across
  49 files.
- README badges, privacy wording, engine visibility, and unsigned-installer
  guidance.
- Public GitHub metadata, discovery topics, Issues, private vulnerability
  reporting, and v0.5.0 release guidance. Projects and Wiki are disabled.
- All implementation commits pushed to public `main`, with the Windows CI
  workflow green.

Remaining launch gates:

- Run one meeting on real Windows 10 hardware when a tester is available. The
  unverified loopback path now fails clearly and does not affect dictation.

The repository was already public when implementation began. No visibility
change was required. The companion site repository remains private.

---

## What the audit found

The repository is in far better shape than a first public launch usually is.
Three things are worth stating plainly because they change what this plan does
*not* need to do.

### The git history is clean and stays as it is

All 169 commits across every branch were scanned for secret-shaped strings
(OpenRouter keys, GitHub tokens, AWS keys, PEM private keys), for leaked local
paths and personal email addresses in tracked files, and for oversized blobs.
All three came back empty.

Yes, git history is fully public on GitHub: every commit, every diff, every
message, permanently. That is exactly why it matters that this one reads well.
Messages like `fix: stop the auto language sentinel crashing every capture` and
`fix(meeting): bound the live transcript tail without losing it silently` are
evidence of careful engineering.

**Do not rewrite or squash the history.** It is the single strongest
credibility signal in the repository, and rewriting would break the signed
release tags that the update channel depends on.

### The "Windows 11 only" claim is not enforced by anything

`AGENTS.md`, the README badge, and the since-retired
`docs/IMPLEMENTATION_PLAN.md` all state Windows 11 x64 only. There is **no Windows version check anywhere** in `src/`
or `scripts/`. The only `process.platform` uses are win32/darwin branches in
`src/main/index.ts`, not version gates.

The stack underneath supports Windows 10:

| Component | Actual requirement |
|---|---|
| Electron 39 (Chromium 142) | Windows 10+. Windows 7/8.1 dropped in Electron 23. |
| `audio: "loopback"` (`src/main/meeting/loopback.ts`) | Windows 10+ |
| uiohook-napi (the PTT low-level hook) | Windows 10 |
| better-sqlite3, sherpa-onnx-node | No version floor above Win10 |

So the claim was conservative labelling, not a technical limit. Today a Windows
10 user gets no message either way: it simply works, or fails without
explanation.

**32-bit (ia32) and ARM64 remain genuinely unsupported.**
`sherpa-onnx-win-x64` is an x64-only native dependency. Supporting either is
real engineering, not a label change, and is out of scope here.

### Residual risk accepted on meetings

Dictation on Win10 is well supported by the dependency analysis. The weakest
link is the meeting path: `audio: "loopback"` combined with `desktopCapturer`
on Windows 10 is the one behaviour not verified on real hardware.

Phase 3 therefore hardens the failure message rather than assuming success. If
a Windows 10 tester becomes available before launch, running one meeting is
enough to close this out.

---

## Phase 1: Legal and repository hygiene

Nothing else matters until this is done. A public repository with no license
grants nobody the right to use, fork, or redistribute the code, which
contradicts shipping a free application.

### 1.1 Add the MIT license

- Create `LICENSE` at the repository root, MIT, `Copyright (c) 2026 Roy Heilbron`.
- Reconcile `package.json`: it currently carries `"private": true` and no
  `license` field. Add `"license": "MIT"`.
  `"private": true` stays: it prevents accidental `npm publish` of an Electron
  app that was never meant to be an npm package, and does not affect the
  repository being public or the license applying.
- Confirm `electron-builder.yml` `copyright` matches the LICENSE holder. It
  currently reads `Copyright (c) 2026 Struq`.

### 1.2 Remove leftovers from the repository root

| File | Action | Why |
|---|---|---|
| `criloreadmetemplate.md` | Delete | A different product's README. Confusing in public. |
| `HANDOFF_PROMPT.md` | Delete | Internal scaffolding for a build that already happened. |
| `UsersRoyheAppDataLocalTempopencode*` (3 dirs) | Delete from working tree | Debug-run junk. Untracked, so no history impact. |
| `blocks-wave.svg`, `bouncing-ball.svg` | **Keep** | Load-bearing: imported by `src/renderer/shared/BlocksWave.tsx` and `scripts/generate-tray-icons.mjs`. |

Add a `.gitignore` rule for the temp-dir pattern so debug runs cannot litter
the root again.

`AGENTS.md` and `CLAUDE.md` stay public. Visible agent instructions are
increasingly read as a positive signal, and yours document real architectural
invariants.

### 1.3 Verify no ignored file was ever committed

`.gitignore` already covers `*.pem`, `*.key`, `*.onnx`, `*.gguf` and `.env*`.
Confirm none was committed before those rules existed. The history scan found
nothing, so this is a confirmation step, not expected remediation.

---

## Phase 2: The `.github/` directory

Currently absent entirely. The standard set, sized so incoming issues arrive
structured without creating much ongoing burden.

### 2.1 `SECURITY.md`

Matters more here than for a typical app, because Struq Voice ships **without a
code signing certificate** and secures its update channel with an Ed25519
signature verified in `src/main/updater.ts`. That design deserves to be stated
publicly, along with a private disclosure route (GitHub private vulnerability
reporting) so a finder does not open a public issue.

Also state the privacy posture plainly, since a dictation app that hears
everything invites the question: dictation audio never leaves the machine on
local engines, the cloud engine is explicit opt-in, and meeting audio is only
written to the local archive when that feature is enabled.

### 2.2 Issue templates

Two YAML forms in `.github/ISSUE_TEMPLATE/`:

- **Bug report.** Required fields: Windows version and build, app version,
  engine in use, and whether the failure is dictation or meetings. These four
  answers resolve most of what would otherwise be a comment round-trip. This
  is also how Windows 10 field reports will surface.
- **Feature request.** Problem first, proposed solution second.

Plus `config.yml` pointing at the website for general questions.

### 2.3 Pull request template

Short: what changed, why, and confirmation that `pnpm typecheck`, `pnpm lint`
and `pnpm test` pass. Mirrors the gates already defined in `AGENTS.md`
section 7.

### 2.4 CI workflow

`.github/workflows/ci.yml`, running on `windows-latest` (native modules target
Windows, so Linux runners are meaningless here):

- pnpm install with the lockfile and a pnpm store cache
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

**Not e2e.** Per `AGENTS.md`, `hook.spec.ts` needs a real microphone and real OS
focus and is flaky in isolation. A red CI badge caused by an unrunnable test is
worse than no badge.

The green badge goes in the README next to the release badge.

---

## Phase 3: Windows 10 and 11 relabel

The claim changes in exactly these places, found by a repository-wide sweep:

| File | Line | Current |
|---|---|---|
| `README.md` | 12 | `Windows_11-x64` badge |
| `README.md` | 251 | "Requirements: Windows 11 x64, and a microphone." |
| `AGENTS.md` | 17 | "Target: **Windows 11 x64 only.**" |
| `CLAUDE.md` | 10 | "Windows 11 x64 only" |
| `.agents/skills/project-context/SKILL.md` | 9 | same sentence |
| `.claude/skills/project-context/SKILL.md` | 9 | same sentence |
| `docs/IMPLEMENTATION_PLAN.md` | 8 | "Windows 11 x64. Sole supported platform for v1." |
| `docs/PLAN-meetings.md` | 2542 | "The product is Windows 11 x64 anyway." |
| | | *(both plan docs were retired after launch; the rows are kept because this is a record of what was audited, not a live index)* |
| `scripts/generate-readme-art.mjs` | 140 | `<dd>Windows 11 x64</dd>` |

New wording: **Windows 10 and 11, 64-bit.** State 64-bit explicitly, because
that constraint is real (`sherpa-onnx-win-x64`) while the version one was not.

`generate-readme-art.mjs` feeds a generated image, so `pnpm docs:art` must be
re-run after editing it, or the badge and the picture will disagree.

### 3.1 Harden the meeting failure path

This is the hedge against the untested Win10 loopback path. The machinery
already exists: `meeting-session.ts` has a `loopback-unavailable` code and the
renderer turns refusals into copy.

The work is to confirm that a Windows 10 loopback failure lands on that code
with a message a user can act on, rather than a generic error. A user told
"system audio capture is unavailable on this machine, dictation still works"
files a useful issue. A user watching a meeting silently produce nothing does
not.

### 3.2 Add a 64-bit guard, not a version guard

No Windows version check is added. A 32-bit or ARM64 machine, where the native
dependency genuinely cannot load, should get a clear message at boot instead of
a native module stack trace. This follows the existing degradation pattern from
`AGENTS.md` section 9, where every native module degrades rather than
preventing boot.

---

## Phase 4: Public-facing polish

### 4.1 README adjustments

The README is already strong and needs no rewrite. Four changes:

- Windows badge to "Windows 10 · 11", per Phase 3
- CI badge from Phase 2.4
- License badge linking to `LICENSE`
- Line 251 requirements updated

The engine table lists **Mock** as a shipped engine ("Nowhere / Fixed text, for
development and the test suite"). Commit `9bd1964` retired it from the product.
Verify whether it is still user-visible; if it is dev-only, it belongs in the
build-from-source section, not the engine table a new user reads first.

### 4.2 What the repository says about itself

Set on GitHub, not in files:

- **Description:** one line, matching the README's opening claim.
- **Topics:** `windows`, `electron`, `speech-to-text`, `dictation`,
  `whisper`, `parakeet`, `on-device`, `typescript`, `privacy`. Topics are how
  people find a project without knowing its name.
- **Website:** the Struq Voice site URL.
- Enable **Issues**. Enable **private vulnerability reporting** (pairs with
  `SECURITY.md`). Leave Discussions off until there is demand.
- Disable the **Projects** and **Wiki** tabs unless used. Empty tabs read as
  abandonment.

### 4.3 The release users actually land on

Most visitors arrive at the releases page, not the README. Confirm the v0.5.0
release has human release notes rather than a bare tag, that the installer
asset is obviously the download, and that the notes say plainly that the app is
unsigned and what SmartScreen will show.

**SmartScreen is the single biggest friction point at launch.** An unsigned
installer shows "Windows protected your PC" to every first-time user, and
without an explanation many will stop there. Covering it honestly in the
release notes and the README install section, including why (a certificate
costs real money for a free tool) and how the update channel is secured
instead, converts a scary moment into a trust signal.

---

## Phase 5: Verification before flipping to public

1. `pnpm typecheck`, `pnpm lint`, `pnpm test` all green locally.
2. CI green on a pushed branch, so the badge is not red on day one.
3. A fresh-eyes read of the README top to bottom as a stranger would.
4. Confirm `LICENSE` renders in the GitHub sidebar and is detected as MIT.
5. Flip the repository to public.
6. Immediately after: check the public URL while signed out. This is the only
   reliable way to catch anything the private view was hiding.

---

## Sequencing

Phase 1 is the gate. Phases 2 and 3 are independent of each other and can be
done in either order. Phase 4 needs 1 to 3 done. Phase 5 is last.

Suggested commits, one concern each per `AGENTS.md` section 11:

```
chore: add MIT license
chore: remove build leftovers from the repository root
docs: add security policy, issue templates and pull request template
ci: run the gates on windows
docs: support windows 10 and 11
feat: report a clear message on unsupported architectures
docs: readme badges, requirements and install friction
```

---

## Explicitly not doing

- **Rewriting git history.** Clean, and an asset.
- **Making the site repository public.** It stays private.
- **32-bit or ARM64 support.** Real work, blocked on the x64-only native
  dependency.
- **Adding `CONTRIBUTING.md` or a code of conduct.** Deferred with the standard
  set. Worth adding when a second contributor actually appears.
- **Code signing.** A certificate is a real recurring cost. The signed update
  channel already covers the threat that matters most; the SmartScreen prompt
  is handled with documentation instead.
- **Running e2e in CI.** Needs a real microphone and OS focus.
