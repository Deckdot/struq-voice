# Struq Voice

Hold a key anywhere in Windows. Speak. Release. The text appears in whatever
field you were focused on.

A tray-resident dictation app: warm microphone, press-and-hold capture,
offline-first transcription, and a paste that lands in the app you were using.

## Features

- **Press-and-hold anywhere.** `Ctrl+Space` to record, release to transcribe.
  Toggle with `Ctrl+Shift+Space`, cancel with `Escape`.
- **Offline-first.** Parakeet TDT runs locally through sherpa-onnx with
  background warmup; whisper.cpp runs as a GPU-capable sidecar. OpenRouter is
  the zero-setup cloud path, explicit opt-in, cost recorded per transcription.
- **Pre-roll.** The 250ms of audio before the key press is included, so no
  first syllable is ever clipped.
- **Fast paste.** Synthesized Ctrl+V at ~2ms via a low-level hook, with a
  PowerShell fallback and optional clipboard restore.
- **History.** Every transcript in SQLite with full-text search, copy and
  delete, virtualized so thousands of rows stay smooth.
- **Custom dictionary.** "tow ree" becomes "Tauri" before delivery.
- **Tray resident.** Starts with Windows hidden to the tray, three icon states,
  recent transcripts, engine radio group.

## Install

- **Release build:** run `pnpm dist` to produce an NSIS one-click installer in
  `release/`.
- **Development:**

  ```bash
  pnpm install
  pnpm dev
  ```

  Native modules are rebuilt for Electron 39 automatically on install. See
  `docs/TROUBLESHOOTING.md` if a module fails to load.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Run in development with hot reload |
| `pnpm typecheck` | TypeScript across node, web and e2e projects |
| `pnpm lint` | ESLint, `strictTypeChecked` |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Build, then Playwright end to end (headless) |
| `pnpm pack` | Build and unpack the app for `release/win-unpacked` |
| `pnpm dist` | Build and produce the NSIS installer |

## Documentation

- `AGENTS.md` / `CLAUDE.md` - the agent context: what this project is, the
  rules, and how to gate work. Read before touching the codebase.
- `docs/FEATURES.md` - what is built, current state, known gaps.
- `docs/DESIGN_SYSTEM.md` - the Velden Linen Forest design system, binding.
- `docs/MODELS.md` - engines, model catalog, download pipeline.
- `docs/TROUBLESHOOTING.md` - known failures and their fixes.
- `docs/ARCHITECTURE.md` - process and window model, boundaries.

AI agents can load the invokable skills in `.agents/skills/` (and the
mirrored `.claude/skills/`) for project context, verification gates, IPC
architecture, native modules and the capture session.

## Privacy

Parakeet and whisper.cpp run entirely on your machine. Audio leaves the
machine only when you choose OpenRouter as the engine, and the API key is
stored encrypted with Windows DPAPI.
