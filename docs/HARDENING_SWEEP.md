# Hardening sweep: orchestrator prompt

Paste the block below into the master orchestrator. It dispatches ten
read-only audit agents across Struq Voice and returns only findings that
need immediate fixing.

Written 2026-08-13, against branch `fix/meeting-speaker-detection` at
commit `b812b3a`.

---

## The prompt

You are the orchestrator for a hardening sweep of **Struq Voice**, a
tray-resident Windows dictation app (Electron 39, React 19, TypeScript
strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).

Repo root: `c:\Users\Royhe\Documents\Coding\Projects\1Personal\DeckVoice`

Dispatch **ten sub-agents in parallel**, one per lane below. Every agent is
**read-only**: it audits, reproduces, and reports. **No agent edits source,
commits, or runs `pnpm test:e2e`.** Agents may write throwaway probe scripts
under the scratchpad directory and run `pnpm typecheck`, `pnpm lint`,
`pnpm test`, and `npx vitest run <file>`, plus `npx tsx <probe>.mts` to
execute a module directly against a temp directory.

### Required reading for every agent, before it starts

1. `AGENTS.md` at the repo root. It is the source of truth.
2. `docs/FEATURES.md` for built/current/known-gaps.
3. Its own lane's files.

### What counts as a finding

We just shipped a fix for exactly the class of bug we are hunting, and it
is the calibration bar. Read the two most recent commits (`76c59e5`,
`b812b3a`) to see it. The bug was:

> The Models view sent `whisperModelId: ""` when a Parakeet model was
> picked. The schema has `min(1)` on that field. The settings store merged
> every patch through `migrateSettings`, which `safeParse`s the whole
> object, so one rejected field failed everything and fell back to
> `settingsSchema.parse({})`. Result: clicking a model silently reset
> theme, hotkeys, speech language, dictionary, onboarding and meeting
> tuning to factory defaults, and the model that was clicked did not even
> get selected. Separately, main resolved the engine id once at boot, so
> switching engine in Settings did nothing until restart.

That is the shape: **a normal user action that silently destroys state,
corrupts data, or makes a setting a lie.** Not a style preference, not a
missing test, not a hypothetical.

**Report a finding only if it is CRITICAL or HIGH.**

- **CRITICAL**: silent data loss or corruption, settings/history/meeting
  records destroyed or overwritten, a secret leaked (logged, written to
  disk in the clear, or crossing IPC), audio leaving the machine without
  explicit opt-in, a crash or hang on a normal path, a security boundary
  broken (`contextIsolation`, `sandbox`, `nodeIntegration`, an IPC channel
  not declared in `src/shared/ipc.ts`, the renderer importing from
  `src/main/`).
- **HIGH**: a user-visible setting or selection that does not take effect,
  reverts, or reports a state that is not real; a state machine that can
  wedge and needs a restart; a resource never released across a normal
  cycle (native handle, window, utilityProcess, listener, timer); a native
  use-after-free or a concurrent call into a module that forbids it.

**Discard everything else.** No MEDIUM, no LOW, no nits, no "consider
adding a test", no refactor suggestions, no praise, no summary of what the
lane does. An agent that finds nothing critical or high says exactly that
in one line, and that is a good outcome.

### Proof bar: every finding must be reproduced

A finding without a reproduction is a guess, and we do not want guesses.
Each reported finding must carry:

1. **Trigger** - the concrete user action or sequence. "Click a Parakeet
   model in the Models view", not "certain settings updates".
2. **Mechanism** - the exact chain, with `file.ts:line` references at each
   hop.
3. **Proof** - one of: a failing `vitest` case the agent wrote and ran, a
   `npx tsx` probe against a temp directory whose output shows the damage,
   or a line-by-line trace where no execution is possible (window/native
   code). Paste the actual observed output. Never paste output you did not
   run.
4. **Blast radius** - what the user loses, and whether it is silent.
5. **Suggested fix** - two or three sentences and the file to change. Do
   not implement it.

If an agent cannot reproduce a suspicion, it either drops it or reports it
under a separate heading `UNPROVEN` with one line saying what it could not
establish. Unproven items never go in the main findings list.

### The ten lanes

1. **Settings, secrets, persistence.** `src/shared/settings.ts`,
   `src/main/store/settings-store.ts`, `src/main/store/secrets.ts`,
   `src/shared/dictionary.ts`. Hunt the same class as the calibration bug:
   every `settingsStore.update` call site in the repo, checked against the
   zod schema for a patch that can be rejected. Schema round-trips,
   migration from older shapes, concurrent writes, a corrupt or partial
   settings.json, a settings file that is read-only or on a full disk.
   Whether the API key can reach a log, a crash dump, or the renderer.
   Note: `settings-store.ts` and `secrets.ts` have no direct unit tests.

2. **IPC surface and process boundaries.** `src/shared/ipc.ts`,
   `src/main/ipc.ts`, `src/main/meeting/ipc.ts`, `src/preload/*.ts`. Every
   channel declared in exactly one place; every handler validating its
   payload rather than trusting the renderer; `PRELOAD_CHANNELS`
   serialization through `additionalArguments`; a handler that can throw
   and leave `invoke` hanging forever; a channel reachable from a window
   that should not have it. `ipc.ts` has no direct unit test.

3. **Boot, wiring, lifecycle.** `src/main/index.ts`, `src/main/windows/*`,
   `src/main/theme.ts`, `src/main/tray.ts`. This file is where both of
   today's bugs lived and it has no unit test. Hunt for any other value
   read once at boot that the user can change at runtime: search for
   `settingsStore.get()` results captured into a `const` outside a
   callback. Also: single-instance handling, the autostart path,
   `ready-to-show` never firing, window close/hide/quit, listeners and
   timers never torn down, the recent boot-ordering change (main window
   now created before engine bootstrap) against a machine with no models
   downloaded.

4. **Capture state machine and hotkeys.** `src/main/session/*`,
   `src/main/hotkeys/*`, `src/renderer/recorder/*`. Every transition in
   and out of every phase; Escape mid-transcribe; the `maxCaptureMs`
   watchdog; key-up lost while the app was busy; a capture started while
   one is finalizing; PTT and toggle pressed together; a phase that can
   wedge so the hotkey stops responding until restart; the pre-roll buffer
   across back-to-back captures.

5. **Engines and the router.** `src/main/engines/*`. The
   local-to-cloud cascade opt-in (audio must never leave the machine
   without it); readiness lying about a model that is missing or
   half-downloaded; timeout and abort actually cancelling the underlying
   work; the Parakeet decode queue and `recognizerPromise` under a model
   switch mid-decode, mid-warmup, and mid-dispose; whisper sidecar process
   left running or orphaned; the OpenRouter key read at call time and the
   cost accounting.

6. **Meeting pipeline.** `src/main/meeting/**`, `src/renderer/meeting/*`.
   The state machine's refusal paths; the utilityProcess forked on start
   and killed on stop, including on crash and on app quit; the bounded
   queue under sustained load; the dictation-always-wins yield; the opus
   archive writer on a full disk or a mid-write stop; speaker clustering
   state across a pause/resume; assets missing or corrupt.

7. **Models: catalog, download, install.** `src/main/models/*`,
   `src/shared/models.ts`. Interrupted download resumed or restarted; a
   partial file passing an existence check (this is how an engine can
   claim ready and then fail); checksum verification; cancel mid-write;
   delete while the engine holds the file open; disk full; the runtime
   installer; two downloads of the same model at once; the selected model
   deleted from under the engine.

8. **Delivery: paste, clipboard, post-processing.** `src/main/post/*`,
   `src/main/platform/win32/paste.ts`, `src/shared/dictionary.ts`. The
   clipboard restored on every path including failure and timeout; a
   dictionary rule that can corrupt a transcript or loop; text cleanup
   against RTL, CJK, emoji, and very long transcripts; the Enter-after-
   paste setting; paste into a window that vanished mid-delivery.

9. **Database and history.** `src/main/db/*`. Migrations forward from
   every shipped schema; FTS5 index consistency after delete and update;
   a corrupt or locked database file degrading rather than crashing boot;
   unbounded growth and the retention setting; transaction boundaries on a
   partial write. `client.ts`, `migrations.ts` and `schema.ts` have no
   direct tests.

10. **Renderer state and i18n.** `src/renderer/main/**`,
    `src/shared/i18n/**`. Views that read settings once and never
    resubscribe (the renderer twin of lane 3's bug); optimistic local state
    that can diverge from main; the `settings.onChange` unsubscribe on
    unmount; every locale having every key with matching placeholders;
    main sending machine-readable codes rather than translated strings
    (AGENTS.md section 16); RTL layout using logical properties.

### Cross-lane rule

If an agent finds something that belongs to another lane, it reports it
anyway with a note naming the lane. Do not drop a real finding on a
technicality, and do not go audit the other lane.

### What you return to me

Wait for all ten. Then produce **one** consolidated report:

- **Deduplicate.** Several lanes will find the same root cause from
  different angles. Merge those into one finding and list the lanes that
  hit it.
- **Rank** strictly by blast radius: silent data loss first, then secret
  or audio exposure, then broken security boundaries, then wedged state,
  then leaks.
- For each finding, keep the trigger, the mechanism with file:line, the
  pasted proof output, the blast radius, and the suggested fix.
- **Cap the report at the ten most severe findings.** If more survive the
  bar, list the overflow as one line each under `ALSO FOUND`.
- End with one line per lane that found nothing, so we know it ran and
  came back clean.

No preamble, no methodology section, no restating these instructions. If
nothing critical or high exists anywhere, say that in a sentence. That is a
real and welcome result, and inventing findings to fill the report is a
failure.
