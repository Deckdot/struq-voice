# Releasing Struq Voice

How a build gets from this repo onto a machine that already has the app, and
what stops a hostile one from doing the same.

## The short version

```bash
pnpm release:auto
```

That is the whole release: it reads what changed, picks the version, runs the
gates, cuts, builds, signs, verifies, publishes, reads the feed back and
pushes. Nothing is typed and no decisions are asked for.

Rehearse it first with `pnpm release:dry`, which really builds, signs and
verifies but never commits, tags, uploads or pushes.

### What it decides on its own

| Decision | How |
|---|---|
| version bump | Conventional Commits since the last `v*` tag: a breaking change gives major, any `feat:` gives minor, otherwise patch |
| release notes | the same commits, grouped Breaking / New / Fixed / Other |
| dirty tree | committed as `chore: pre-release working tree` before the cut |
| is it safe | typecheck, lint and unit tests, **before** the version is cut |

The bump rule is not in the script. It lives in `src/shared/release-plan.ts`
under typecheck and unit tests, because it is the only step here that makes a
judgement call: every other step fails loudly when it is wrong, while a bump
chosen badly fails silently and the version number quietly stops meaning
anything.

### Why the gates run before the cut

A cut is a commit and a tag, and undoing one means rewriting history that may
already have been fetched. Everything before the cut is reversible and
everything after it is verified, so the irreversible step sits between a
passing test suite and a verifier that refuses to publish what it cannot check.

Preflight also fails early on a wrong branch, a missing or unauthenticated
`gh`, or a missing signing key. Each of those would otherwise surface after a
116MB build.

### The manual checklist

The automated gates cover the pure logic. They cannot cover a synthesized
paste landing in someone else's window, a keyboard hook that stops firing on
the tenth press, or a mic unplugged mid-sentence. That is exactly where this
app breaks, so this list is run by hand before every release.

- [ ] Hold the hotkey in Notepad, speak, release. Text lands at the caret.
- [ ] The same in Chrome, VS Code, Slack, Windows Terminal, and an Office app.
- [ ] The same while the main window is open but unfocused.
- [ ] Main window focused: it inserts in-app and does **not** synthesize a paste.
- [ ] **Ten consecutive captures; the hook still fires on the tenth.**
- [ ] Typing normally while idle: zero perceptible input lag.
- [ ] `Escape` mid-capture: nothing pasted, nothing in history.
- [ ] Clipboard contents restored after a paste.
- [ ] Unplug the mic mid-capture: clear error, no crash, recovers on replug.
- [ ] Kill the network on the cloud engine: clear error, offers local.
- [ ] Second launch focuses the existing window instead of starting a copy.
- [ ] Overlay on the correct monitor in a multi-display setup.
- [ ] `prefers-reduced-motion` removes motion without breaking layout.
- [ ] Overlay holds 60fps while Parakeet runs.
- [ ] Install over an existing copy: the update applies and the app relaunches.

### Flags

| Flag | When |
|---|---|
| `--dry-run` | rehearse without publishing |
| `--bump minor` | override the inferred bump, or give an explicit `1.2.3` |
| `--skip-gates` | retry after a failed upload, gates already passed |
| `--no-commit` | refuse on a dirty tree instead of committing it |
| `--yes` | allow a branch other than `main` |

### Doing it by hand

The steps underneath are still there and still work on their own:

```bash
pnpm release:cut patch    # bump, commit, tag
pnpm ship                 # build, sign, verify, publish
```

The version is read from `package.json` by every step after the cut, so it
cannot be mistyped into one of them. Reach for these when recovering from a
partial failure, see the table at the end of this document.

## Why updates are signed

Struq Voice ships **without a code signing certificate**. That is fine while the
only way onto a machine is running an installer you were handed: there is no
remote path in, so there is nothing for a certificate to defend.

An update channel creates that path. It is, precisely, "download what is at this
URL and execute it".

On Windows `electron-updater` authenticates an update by comparing the installed
binary's publisherName against the update certificate's Common Name. With no
certificate there is nothing to compare, and there is a known bypass of that
check even when there is (CVE-2024-39698). So the library's own verification is
not load-bearing here. `src/main/updater.ts` is.

Every downloaded artifact is checked against the Ed25519 public key in
`src/shared/release-key.ts` before it is allowed to install, and a failed check
**aborts**. Not warns, not prompts: a prompt people click through is the same as
no check, one step removed.

### What is signed

```
<sha512-hex>|<version>
```

A signature over the hash alone would let an attacker re-serve a **genuinely
signed older build** with a known bug in it. The bytes are authentic, the
signature verifies, and the app downgrades itself into the hole. Binding the
version into the signed message is what makes that fail.

### The key

| Half | Where |
|---|---|
| public | `src/shared/release-key.ts`, committed, shipped in every build |
| private | `~/.struq/struq-voice-release-private.pem`, mode 600, never committed |

Back up the private key somewhere durable (a password manager). **Rotating it
means every installed copy stops accepting updates**, because each one verifies
against the key it was built with. A rotation needs a hand-delivered build to
every machine, exactly like the first install did.

`STRUQ_VOICE_RELEASE_KEY` overrides the path if the key lives elsewhere.

## The steps

### 1. Cut the version

```bash
pnpm release:cut patch     # or minor, major, or an explicit 1.2.3
```

Refuses on a dirty tree. A release built from uncommitted work cannot be rebuilt
from its tag, which makes "which build is on that machine" unanswerable exactly
when someone is asking. Also refuses to go backwards: a feed serves one
`latest.yml`, so a lower version would offer every installed copy a downgrade,
which the signature check then rejects as a replay.

Commits `chore: release vX.Y.Z` and tags `vX.Y.Z`.

### 2. Ship

```bash
pnpm ship
```

Which is `pnpm release` then `pnpm release:publish`:

| Step | Script | What it does |
|---|---|---|
| build | `build-installer.mjs` | NSIS installer, blockmap, `latest.yml` |
| sign | `sign-release.mjs` | Ed25519 over `<sha512>\|<version>` |
| verify | `verify-release.mjs` | independently re-checks all three properties |
| publish | `publish-release.mjs` | uploads to the GitHub release, then reads it back |

Run any of them alone: `pnpm dist`, `pnpm release:sign`, `pnpm release:verify`,
`pnpm release:publish --dry-run`.

### Why the verifier shares no code with the signer

A verifier that imports the signer's helpers proves the helpers agree with
themselves and nothing more. If the message shape is wrong in both, or the hash
is over the wrong bytes in both, a shared-code check passes and the protection
is imaginary. `verify-release.mjs` therefore re-reads the artifact, re-computes
the hash, rebuilds the signed message from its own literal, and reads the public
key **as text** out of `src/shared/release-key.ts`, so it checks the key the
shipped build will actually use.

It names which of three checks failed, because they mean different things:

| Check | A failure means |
|---|---|
| hash | corrupted or swapped artifact |
| version | replay of an older signed build |
| signature | forgery, or the wrong key |

## Where the build goes

`%TEMP%/struq-voice-release`, not `release/` in the repo.

electron-builder stages the unpacked app as `<out>/win-unpacked.tmp` and renames
it into place. Under `Documents` on Windows that rename can fail with `EPERM`:
something holds a handle on a directory of freshly extracted `.exe` and `.dll`
files, with Defender real-time protection the usual suspect. A workaround that
has to be typed on every release is not a fix, so the working path is the
default. `STRUQ_VOICE_RELEASE_DIR` overrides it.

## What a user sees

Settings has an Updates panel: the running version, a check button, and one line
of state. On a packaged build the app also checks once at boot.

Nothing restarts on its own. Dictation runs alongside other work, and an app
that restarts itself mid-sentence is worse than one running last week's build
for another hour. The install is silent (`/S`) with a forced relaunch, so the
click costs a few seconds rather than a wizard the user already agreed to.

A **refused** update is shown in red and says nothing was installed. That state
is distinct from "up to date" on purpose: a failed signature means someone
served bytes that did not come from the release key, and collapsing that into
idle would make an attack look exactly like a quiet morning.

## Verifying by hand

```bash
# Build, sign, verify without publishing
pnpm release
pnpm release:publish --dry-run

# Prove the gate: flip one byte and re-verify
printf 'X' | dd of="$TEMP/struq-voice-release/struq-voice-<v>-setup.exe" \
  bs=1 seek=100 conv=notrunc
node scripts/verify-release.mjs   # must FAIL on hash and signature, exit 1
```

The unit tests in `src/main/updater.test.ts` cover the refusal paths: swapped
artifact, downgrade replay, wrong key, tampered signature, unreachable manifest.

## When a release fails halfway

`release:auto` names the stage that failed and what to run. In summary:

| Failed at | State | Recovery |
|---|---|---|
| preflight or gates | nothing changed | fix, re-run `pnpm release:auto` |
| gates, after auto-commit | tree committed, not cut | fix and re-run, or `git reset --soft HEAD~1` to get the changes back |
| build / sign / verify | cut and tagged locally, nothing published | fix, then `pnpm ship` to retry from the tag. Or undo: `git tag -d vX.Y.Z && git reset --hard HEAD~1` |
| publish | built and verified, tagged locally | `pnpm release:publish` |
| push | **the release is already live** | `git push origin main && git push origin vX.Y.Z` |

The last row is the one to read carefully. After a failed push the release is
on the feed and only the local repo is behind, so re-running the whole thing
would cut a second version for no reason. Just push.

## First install

The NSIS installer is assisted, not one-click: choosing a directory and reading
what the app is are reasonable to ask once, and unreasonable on every patch.
Updates after that are silent.
