---
name: verification-gates
description: "The exact commands and rules for gating work in Struq Voice. Use whenever finishing a slice, before a commit, or when asked to 'verify', 'run the gates', 'typecheck', 'lint', 'run tests', or 'check it works'. Runs pnpm typecheck, pnpm lint, pnpm test and a headless boot smoke; knows that pnpm test:e2e must NOT be run unprompted (slow, flaky hook spec) and how to clean up stray Electron processes. NOT for understanding the codebase (use project-context) or fixing a specific e2e spec."
argument-hint: "[typecheck | lint | test | smoke]"
---

# Verification gates for Struq Voice

The ONLY acceptable definition of "done" for any slice. Run these, in this
order, before committing.

## The gates

```bash
pnpm typecheck    # tsc --noEmit -p tsconfig.node.json && web && e2e
pnpm lint         # eslint . (typescript-eslint strictTypeChecked)
pnpm test         # vitest run (unit tests, currently 106)
```

All three must pass with zero errors. There is no softer bar.

## Boot smoke (when you want confidence without the full suite)

```bash
pnpm exec electron-vite build
STRUQ_VOICE_E2E=1 STRUQ_VOICE_ENGINE=mock \
  STRUQ_VOICE_USERDATA=$(mktemp -d) \
  timeout 12 npx electron --headless out/main/index.cjs
```

Expect no `throw`, `ZodError`, or uncaught `error:` lines (ignore GPU and
network-service noise). Windows: `timeout` may be absent in bash; use
`timeout` if present, otherwise a fixed sleep + taskkill.

## e2e: do NOT run unprompted

`pnpm test:e2e` builds and runs Playwright. It is headless but slow, and
`hook.spec.ts` needs a real microphone and real OS focus, so it fails in
isolation on machines without a mic or with hook contention. The user runs
e2e themselves. Do not run it unless explicitly asked, and do not "fix" the
e2e specs without being asked.

## Cleanup

Always kill stray processes after any smoke or manual launch:

```bash
taskkill //F //IM electron.exe
taskkill //F //IM "Struq Voice.exe"
```

## Lint pitfalls that come up often

- No async functions without an await (add `await Promise.resolve()` in
  fakes).
- No returning a void expression from an arrow shorthand; wrap in braces.
- Template literals with numbers need `String(n)`.
- No unnecessary type assertions or conditionals the checker can prove.
- No unused imports or variables (names must match `/^_/` to be exempt).
- `noUncheckedIndexedAccess`: index arrays only after a bounds check.
- `exactOptionalPropertyTypes`: do not set optional fields to `undefined`.
