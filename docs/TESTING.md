# Testing strategy

Struq Voice uses risk-weighted tests. The goal is confidence in behavior that
can lose audio, paste into the wrong place, corrupt user data, weaken update
integrity, or fail only under timing pressure. Raw test count is not a quality
metric.

## What belongs in the unit suite

- State transitions, cancellation, timeouts, and late asynchronous results.
- Security and privacy boundaries, especially update verification and the rule
  that local audio never falls back to cloud without explicit consent.
- Native degradation paths for SQLite, keyboard hooks, and local engines.
- Data integrity, resumable downloads, checksum verification, and cleanup.
- Pure algorithms with meaningful edge cases: audio framing, text cleanup,
  speaker clustering, locale resolution, and screen positioning.
- Regression tests for failures that were plausible, costly, or difficult to
  reproduce manually.

## What does not belong

- Assertions that only repeat a TypeScript type or a constant object literal.
- Tests of framework or third-party library behavior.
- Multiple cases that exercise the same branch without a distinct failure mode.
- Source-text snapshots that change during harmless refactors, unless the text
  itself enforces a binding product contract.
- Tests added only to increase a coverage percentage or case count.

## Layers

1. `pnpm test` runs deterministic Vitest tests. It is the fast gate for every
   slice and must remain suitable for local use and Windows CI.
2. `pnpm test:coverage` is an audit tool. It reports the main process, shared
   contracts, preloads, and renderer library logic. Generated locale catalogs,
   the generated icon registry, and the main composition root are excluded
   because their line totals obscure useful signals. Coverage is reviewed per
   risk area, not enforced as a repository-wide percentage.
3. `pnpm test:e2e` builds and drives Electron. It is intentionally manual
   because the keyboard-hook path needs a real microphone and real OS focus.
   Do not add it to unattended CI unless that hardware contract changes.
4. The release checklist covers SmartScreen, real paste targets, microphone
   hardware, Windows autostart, and meeting loopback. These cannot be made
   trustworthy by mocking them in Vitest.

## Review standard for a new test

A test should answer all four questions:

1. What user-visible or operational failure does it prevent?
2. Which distinct branch, boundary, race, or regression does it exercise?
3. Would it fail for the wrong implementation while surviving a safe refactor?
4. Is this the cheapest reliable layer for that behavior?

If those answers are weak, improve an existing test or leave the case out.

## Current audit

The public-launch audit retained the larger suites around updates, capture,
meetings, live transcription, model downloads, engine fallback, and storage.
They cover separate failure modes and finish quickly. Trivial Result-builder
tests, a type-only subscription check, and duplicate state assertions were
removed. The principal remaining gap is renderer behavior, especially Settings
and accessibility, not excess coverage in the main process.
