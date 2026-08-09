## Summary

<!-- One or two sentences: what changes, and why. -->

## Change type

- [ ] `feat` - new capability or user-visible behavior
- [ ] `fix` - bug fix
- [ ] `refactor` - internal restructure, no intended behavior change
- [ ] `docs` - documentation, skills, or comments
- [ ] `test` - tests only
- [ ] `chore` / `build` - tooling, config, dependencies, CI

## What changed

-
-

## Verification

A branch takes the highest tier it touches. See
[the verification policy](https://github.com/Deckdot/struq-voice/blob/main/AGENTS.md#8-verification-policy).

- [ ] **T1** - docs, copy, screenshots, comments
- [ ] **T2** - renderer views, state machines, IPC, engines
- [ ] **T3** - native modules, updater, paste, meeting worker, release scripts

Commands actually run:

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm smoke:boot`

**Deliberately not run, and why:**

<!-- e.g. "pnpm test:e2e: needs a real mic, and this change does not touch capture." -->

**Probe** - the exact commands or clicks that prove this works:

```
```

## UI evidence

<!-- Visual changes only. Delete this section otherwise. -->

| Before | After |
| ------ | ----- |
|        |       |

## Docs

- [ ] Documentation changed in this same PR
- [ ] `docs/FEATURES.md` updated (new or changed user-visible capability)
- [ ] Skills edited in `.claude/skills/` and mirrored with `pnpm skills:sync`
- [ ] No documentation impact

## Risks

<!-- What could this break? What is not covered by the checks above? -->

## Related issues

Closes #
