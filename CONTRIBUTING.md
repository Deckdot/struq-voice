# Contributing to Struq Voice

Thanks for looking. This is a small project with a deliberate shape, so this
page is short and specific rather than generic.

## Before you start

Open an issue first for anything larger than a bug fix. Struq Voice has a
binding design system and a few hard boundaries, and it is cheaper to find out
in an issue than in a review that a change fights one of them.

Good first contributions: a reproducible bug with the steps that trigger it,
a fix for something in [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md),
or a translation. The interface is fully internationalized and new locales are
welcome.

## Build it

**Requirements:** Windows 10 or 11 (64-bit), Node 22 or newer, pnpm 10, and
the Visual Studio build tools that native modules need.

```bash
git clone https://github.com/Deckdot/struq-voice.git
cd struq-voice
pnpm install     # native modules rebuild for Electron 39 automatically
pnpm dev
```

If a native module fails to load,
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) covers the known cases.
Every native module degrades rather than blocking boot, so the app still
starts: without `better-sqlite3` there is no history, without `uiohook-napi`
push-to-talk falls back to toggle.

## Verification tiers

Match the tier to the risk and run it before you push. The full table, with
the reasoning, is in [`AGENTS.md`](AGENTS.md#8-verification-policy).

| Tier | Touches | Run |
|---|---|---|
| T1 | docs, copy, screenshots, comments | `pnpm typecheck && pnpm lint` |
| T2 | renderer views, state machines, IPC, engines | T1 + `pnpm test` |
| T3 | native modules, updater, paste, meeting worker, release scripts | T2 + `pnpm smoke:boot` |

A branch takes the highest tier it touches. Tier up when unsure.

`pnpm test:e2e` is deliberate, never automatic: it is slow and one spec needs
a real microphone and real OS focus, so it is flaky in isolation. Do not run
it unprompted, and do not "fix" the e2e specs as a side effect of another
change.

Kill strays after a smoke run or a manual launch:

```bash
taskkill //F //IM electron.exe
taskkill //F //IM "Struq Voice.exe"
```

## Open a pull request

- Branch from `main`. Do not commit to `main` directly.
- [Conventional commits](https://www.conventionalcommits.org/): `feat:`,
  `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `build:`. One concern per
  commit.
- Explain **why** in the commit body. The diff already says what.
- If the running system changed, its documentation changes in the same
  commit, not a follow-up.
- Fill in the PR template, including which tier you ran and anything you
  deliberately did not run. A gate nobody can see the output of is a claim,
  not a check.
- Give the PR a probe: the exact commands or clicks that prove it works,
  copy-pasteable.

CI runs typecheck, lint and tests on Windows for every pull request, plus a
check that the agent skill mirror is in sync.

## House rules

These are non-negotiable and are enforced in review:

- **No em dashes, en dashes or horizontal bars** anywhere: code, comments,
  docs, commit messages. Use commas, colons, parentheses, or two sentences.
- **The renderer never imports from `src/main/`.**
- **Every IPC channel is declared in `src/shared/ipc.ts` and nowhere else.**
- **Every window is `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`.** No exceptions.
- **Never commit secrets.** No API key is ever logged or sent across IPC.
- Comments carry information or they are not written. The header doc comments
  in existing files are the house style.
- TypeScript strict, plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.

## Where things are

[`docs/README.md`](docs/README.md) indexes every document and says when to
read it. [`AGENTS.md`](AGENTS.md) is the source of truth for the architecture,
the boundaries and the invariants; it routes a task to the skill that owns it.

## Security

Do not open a public issue for a security problem. See
[`.github/SECURITY.md`](.github/SECURITY.md).

## Licence

By contributing you agree that your contributions are licensed under the
MIT Licence that covers this project.
