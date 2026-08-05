# Struq Voice: CLAUDE.md

Claude-specific companion to AGENTS.md. AGENTS.md is the shared source of
truth; this file adds the Claude Code specifics. Read AGENTS.md first, then
use this file for invocation details and skill loading.

## What this project is

A tray-resident Windows dictation app: hold a key anywhere in Windows,
speak, release, and the transcript appears in the focused field. Windows 11
x64 only. Electron 39 pinned, React 19, Tailwind v4, TypeScript strict.

The single design document that binds every UI decision is
`docs/DESIGN_SYSTEM.md` (Velden Linen Forest). Build views against it or
you have a bug.

## First thing in every session

1. Read `AGENTS.md` in full. It is the source of truth.
2. Load the `project-context` skill (`.claude/skills/project-context/`).
   It gives the architecture map, the file inventory and the current state
   in one shot.
3. Read `docs/FEATURES.md` for the built/current/known-gaps picture.
4. If the task is UI, skim `docs/DESIGN_SYSTEM.md`.

## Skills (invokable)

Load the matching skill when the task touches its domain. They live in
`.claude/skills/<name>/SKILL.md` with YAML frontmatter (name + description).

- `project-context` - full picture before any task.
- `verification-gates` - the exact gate commands and the "don't run e2e
  unprompted" rule.
- `ipc-architecture` - how to add an IPC channel end to end.
- `native-modules` - the native modules, the rebuild script, degradation.
- `capture-session` - the state machine, hotkeys, audio pipeline.

The skills are small: they exist so a cold session does not have to rediscover
the invariants by reading the whole tree.

## Verification gates

The only acceptable definition of "done":

```bash
pnpm typecheck    # tsc -p tsconfig.{node,web,e2e}.json
pnpm lint         # eslint . (strictTypeChecked)
pnpm test         # vitest unit tests
```

**Do not run `pnpm test:e2e` unprompted.** It is slow, headless, and
`hook.spec.ts` needs a real microphone plus real OS focus, so it is flaky in
isolation. The user runs e2e themselves. Do not "fix" the e2e specs without
being asked.

If you want confidence without the full suite, run the boot smoke from
AGENTS.md section 7. Kill stray processes afterwards with
`taskkill //F //IM electron.exe` and `taskkill //F //IM "Struq Voice.exe"`.

## Hard rules

- **Never use em dashes (U+2014), en dashes (U+2013) or horizontal bars
  (U+2015) anywhere**: code, comments, docs, commit messages, chat. Use
  commas, colons, parentheses, or two sentences.
- Do not add comments unless they carry real information. Header doc
  comments in the existing files are the house style.
- Follow existing patterns. When a file already uses dependency injection
  for testability (engines, paste, models), new code should too.
- Never commit secrets. Never log or cross IPC with API keys.
- The renderer never imports from `src/main/`.
- Every IPC channel is declared in `src/shared/ipc.ts` and nowhere else.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.

## Process notes for Claude Code

- This repo is Windows (win32). Use `taskkill //F //IM ...` (double slashes
  work in bash). Prefer `node`/`pnpm` through the repo scripts, never raw
  `npm`.
- The e2e harness strips `ELECTRON_RUN_AS_NODE` from the environment; if you
  ever launch Electron manually from a terminal that exported it, unset it
  first or the launch fails opaquely.
- Main-process smoke runs go through `out/main/index.cjs` after
  `electron-vite build`; `pnpm dev` is for live development, not for tests.
- Commit only when the user asks. Conventional commits, one concern each.
