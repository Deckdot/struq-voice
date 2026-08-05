# Struq Voice: greenfield handoff package

Everything needed to build Struq Voice from an empty directory. Self-contained: nothing here
depends on the current Tauri repo.

## Contents

| File | What it is |
|---|---|
| `HANDOFF_PROMPT.md` | The prompt to paste into a fresh agent session. Start here. |
| `IMPLEMENTATION_PLAN.md` | Architecture, stack with rationale, the hard parts, seven phases with acceptance criteria. |
| `DESIGN_SYSTEM.md` | Velden Linen Forest. Tokens, type, space, elevation, motion, components, anti-patterns, self-review. Binding. |
| `assets/theme.css` | Ready-to-use Tailwind v4 token layer. Full palette derivation, contrast-verified. |

## How to use it

```
1. Create the new empty folder.
2. Copy into it:
     IMPLEMENTATION_PLAN.md   →  docs/IMPLEMENTATION_PLAN.md
     DESIGN_SYSTEM.md         →  docs/DESIGN_SYSTEM.md
     assets/theme.css         →  docs/assets/theme.css
3. Open a fresh agent session in that folder.
4. Paste everything between the two rulers in HANDOFF_PROMPT.md.
```

The agent copies `docs/assets/theme.css` to `src/renderer/styles/theme.css` during Phase 0, before
any UI is built.

## What is already settled

Decided, verified, and not worth reopening:

- **Electron 39.x, pinned.** Not 43+. StruqADE runs `better-sqlite3` and `node-pty` on the 39 line
  in production, so native prebuild availability is known rather than assumed.
- **OpenRouter has a real STT endpoint.** `POST /api/v1/audio/transcriptions`, OpenAI-compatible,
  `openai/whisper-large-v3`, 25MB cap. Confirmed against live docs, not assumed from the chat
  completions audio path.
- **Playwright drives Electron correctly** with `@playwright/test` 1.62.1. Verified end to end on
  this machine: launched, driven, evaluated in the main process, asserted clean. The console-error
  gate was also verified in the failing direction, so it is not vacuous.
- **`ELECTRON_RUN_AS_NODE=1` leaks from VS Code terminals** and breaks `_electron.launch` opaquely.
  Diagnosed, and the harness in the plan strips it.
- **The font packages exist.** `@fontsource/instrument-sans`, `instrument-serif` and
  `ibm-plex-mono`, all at 5.3.0 on npm.
- **The palette is fully derived.** Five source values expanded into surfaces, ink, hairlines,
  accent siblings, semantics and capture states, with approximate WCAG ratios stated per token.
  The given accent is not AA-safe behind white body text, which is why `--color-accent-solid`
  exists at a lower lightness. Same hue, same chroma, brightness only.

## What is not yet verified

One open hypothesis, called out in both the plan and the prompt:

**`uiohook-napi` may stop firing after `getUserMedia`.** The hidden recorder window should avoid
[issue #54](https://github.com/SnosMe/uiohook-napi/issues/54) by construction, since the reported
workaround is to allocate the stream while unfocused. It has not been proven. Phase 2 requires ten
consecutive capture cycles with the main window focused before anything is built on top of it.
Fallbacks are named in the plan's risk table.

## Relationship to the current repo

None, by design. The existing `struq-voice` Tauri scaffold is not migrated, imported, or referenced.
It stays where it is as history.

The one external dependency is the reference implementation at
`C:\Users\Royhe\Documents\Coding\Projects\1Personal\StruqMain\StruqADE`, which has production-tested
overlay, paste, `safeStorage` and OpenRouter code worth porting. Exact file and line references are
in section 11 of the plan.
