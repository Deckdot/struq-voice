# Hardening plan

The remediation plan for the ten-lane sweep. Written 2026-08-13 against
`fix/meeting-speaker-detection` at `b812b3a`.

Findings are grouped into waves by **shared root cause and shared file**,
not by the report's ranking. Two findings that touch the same twenty lines
belong in one commit; two findings that share a rank but nothing else do
not. Every wave is one branch, one concern, one PR.

## Verification before writing the plan

I re-checked the top findings against the source rather than trusting the
report. Confirmed in code: the English filler fallback containing `er`
(`text-cleanup.ts:67` with `er` at `:26`), the unguarded `onTranscript`
call (`capture-session.ts:240-242`), `removeMeeting` deleting only the row
(`meeting-store.ts:298-301`), `archive-writer.open` attaching no `error`
listener (`archive-writer.ts:36-51`), `stashedSomething` gating on
`readText().length` (`paste.ts:137-138`), both renderer views hardcoding
the v3 model id (`StatusCluster.tsx:59`, `DictateView.tsx:189`), and
`prerollMs` having **no reader anywhere in main**.

One correction to the report. Finding 9 arm (a) claims the both-synthesis-
fail path wrongly leaves the transcript on the clipboard. It does leave it,
but that is deliberate and documented at `paste.ts:157-160`: the transcript
stays so the user can press Ctrl+V manually. The real defect on that path
is narrower: the overlay draws a success check instead of telling the user
to paste manually. Wave 4 fixes the honest-state-report half and leaves the
clipboard behaviour alone.

---

## Wave 1: silent destruction of user content

Highest blast radius, smallest diffs, no architectural risk. Ship first.

### 1.1 Filler removal deletes Danish and Norwegian "er" (finding 1)

`src/main/post/text-cleanup.ts`

The fallback is backwards. A missing filler table means "we do not know
this language's fillers", which must remove nothing. Falling back to
English applies English fillers to a language where `er` is the verb "is".

- Change `removeFillers` (`:65-77`) so a locale absent from `FILLER_TABLE`
  yields an empty filler set, not `FILLER_TABLE["en"]`.
- Keep the English fallback for the genuinely invalid case only: when
  `resolveFillerLocale` rejects the tag (`:57-61`) and returns its `"en"`
  sentinel, which is the `auto` path the header comment documents.
  Distinguish "unresolvable, use en" from "resolved to a language we have
  no table for, remove nothing" by returning `null` for the latter.
- Add tables for the offered languages that have none: `da`, `nb`, `fi`,
  `uk`, `ko`, `ar`, `hi`, `he`. Where the fillers are not known with
  confidence, ship an empty array deliberately rather than guessing; an
  empty array now means "removes nothing", which is the safe outcome.
- Tests: `er` survives in `da` and `nb`; `um` still goes in `en`; `auto`
  still routes to English; every language offered in `TranscriptionTab`
  has an entry so the table and the picker cannot drift.

### 1.2 Clipboard: non-text content destroyed, failure states lie (findings 8, 9)

`src/main/platform/win32/paste.ts`, `src/renderer/overlay/overlay.tsx`

- Add `availableFormats: () => string[]` to `PasteDeps` and wire it to
  `clipboard.availableFormats()` in `createDefaultDeps` (`:95-112`).
- Replace `stashedSomething = stashed.length > 0` (`:137-138`) with a
  format-aware decision. When the clipboard holds non-text formats we
  cannot round-trip through `writeText`, do not silently destroy them:
  return `ok({ inserted: false })` without overwriting, so the transcript
  is delivered by the manual path and the user's image survives.
- Wrap the restore write (`:182`) in try/catch. A throw there currently
  rejects out of the function with the user's clipboard already gone.
- In `overlay.tsx` `DeliveringView` (`:264-289`), branch on the `inserted`
  flag and render the existing "Copied, press Ctrl+V" string
  (`i18n/locales/en.ts:50`) when it is false. The string already exists
  and is currently reachable only from `ErrorView`, which this path never
  calls. This is the fix for finding 9's real half and for the ALSO FOUND
  "app's own window focused" item, which returns `inserted: false` at
  `paste.ts:133-135` and hits the same silent check mark.
- Tests: image-only clipboard survives a dictation; a restore throw does
  not reject; `inserted: false` renders the manual-paste copy.

**Wave 1 gate:** `pnpm typecheck && pnpm lint && pnpm test`. T2.

---

## Wave 2: settings persistence

Findings 2 and 10 are the same subsystem and the same file. One commit.

`src/main/store/settings-store.ts`, `src/shared/settings.ts`

### 2.1 Corrupt settings.json resets the profile at boot (finding 2)

The calibration fix hardened the **patch** path via `applySettingsPatch`.
The **read** path still funnels every failure into
`settingsSchema.parse({})` (`settings.ts:217-221`). Same bug, other door.

- Extract the per-key salvage loop already inside `applySettingsPatch`
  into a shared helper, and use it on the boot read: start from
  `DEFAULT_SETTINGS`, accept every field of the parsed file that
  validates, drop only the fields that do not.
- Distinguish "file absent" (a fresh install, defaults are correct) from
  "file present but unparseable" (salvage, and never overwrite until the
  user changes something).

### 2.2 Non-atomic writes (finding 2, second half)

`save()` is a bare `writeFileSync` (`:28-35`), so an interrupted write
produces exactly the truncated file that 2.1 has to salvage. Write to a
temp file and rename, the pattern the model downloader already uses.
Fixing this removes the main cause of the corruption 2.1 recovers from.

### 2.3 Write failures are swallowed (finding 10)

`save()` catches and discards every error, so the UI reports a change that
never reached disk and silently reverts at next boot.

- Have `update` return, or record, a persistence status; forward it
  through `settingsUpdateChannel` (`src/main/ipc.ts:391-397`).
- Surface a non-blocking warning in Settings when a write fails. Keep the
  in-memory value: the user's intent is still honoured for the session,
  they are simply told it will not survive a restart.

**Wave 2 gate:** T2 plus a `smoke:boot`, since this changes boot-path IO.

---

## Wave 3: state machines that wedge or leak

### 3.1 History write failure wedges capture (finding 4)

`src/main/session/capture-session.ts`, `src/main/index.ts`

The state machine must never be taken down by an optional hook. Fix at
both levels, because either alone leaves the other caller exposed:

- Wrap `options.onTranscript?.(text, meta)` (`:240-242`) in try/catch. A
  throwing hook is logged and the machine continues to `delivering`; the
  transcript still gets pasted, which is the part the user cannot recover.
- Independently, wrap the `history.insert` + `refreshRecentTranscripts`
  block (`index.ts:619-632`), honouring the db layer's stated contract
  that history degrades rather than breaking transcription
  (`db/client.ts:3-6`).
- Tests: a throwing `onTranscript` still reaches `delivering`, still
  delivers, and the next `start()` is accepted.

### 3.2 Meeting start/stop race leaves a zombie recorder (finding 7)

`src/main/meeting/meeting-session.ts`

The most delicate fix in the sweep. `start()` awaits four times and never
re-checks ownership, so a `stop()` landing mid-start tears down state that
the in-flight `start()` then rebuilds with no owner.

- Give each start attempt a generation token. After every `await` in
  `start()` (`:376`, `:388-416`, `:437`), re-check that the token is still
  current; if not, unwind what this attempt created (destroy the window it
  made, close its archive, kill its worker) and return without entering
  `recording`.
- Have `stop()` invalidate the token before it begins tearing down, so an
  in-flight start observes the cancellation at its next resume point.
- Reject a `start()` that arrives while another start is in flight rather
  than running two.
- Tests: the lane's own race probe (`stop` during `starting`) must end
  with no live window, no `meeting-audio:begin` after teardown, and no
  phantom `complete` row.

### 3.3 Archive write failure crashes the app (finding 3)

`src/main/meeting/archive-writer.ts`, `src/main/meeting/meeting-session.ts`

- Attach an `error` listener in `open()` (`:36-51`). An unlistened stream
  `error` is an uncaught exception, and main has no `uncaughtException`
  handler, so this kills the tray app mid-meeting.
- Record the first error and expose it (a `lastError`), so `close()` can
  report that its byte count is untrustworthy instead of returning a
  truncated size that the session records as success.
- In `meeting-session.ts` (`:512-520`), finalize a meeting whose archive
  errored as `interrupted` with an audio-error marker, never `complete`.
- Tests: a stream error does not throw out of process; a failed archive
  finalizes `interrupted`.

### 3.4 Audio source never released on `fail()` while listening (ALSO FOUND, lane 4)

`src/main/session/capture-session.ts`. The armed worklet and level meter
leak for the app lifetime after one mic loss. Release the source on the
`fail` transition out of `listening`, the same way `cancel` does.

**Wave 3 gate:** T3. Native modules, the meeting utilityProcess and the
capture machine are all in scope, so `pnpm smoke:boot` is required.

---

## Wave 4: settings and selections that are lies

Same class as the calibration bug: the UI claims a state the system does
not have. Individually small, collectively the thing that makes the app
feel unreliable.

### 4.1 Model pick destroys the fallback opt-in (finding 5)

`src/renderer/main/views/ModelsView.tsx:309-324`. Both branches send
`engine: { primary, fallback: null }`, wiping the backup service, which is
also the only consent gate for local-to-cloud cascading
(`index.ts:498`). Spread the existing engine object instead of
overwriting: `engine: { ...settings.engine, primary: "parakeet" }`. This
is the exact bug I fixed for `whisperModelId`, surviving in the adjacent
field, and it needs `ModelsView` to read current settings, which it
already holds in `activeSelection`.

### 4.2 Deleting a meeting leaves the recording on disk (finding 6)

`src/main/db/meeting-store.ts:298-301` deletes the row only; the
`recording.webm` survives forever with no UI that can reach it. Sensitive
audio retained after an explicit delete. Delete the meeting's directory in
the same operation, sharing the retention sweep's implementation
(`index.ts:261`) so the two paths cannot diverge.

### 4.3 Boot-frozen values (ALSO FOUND: lanes 1, 3)

The residue of the bug I already fixed for the engine id. Convert each to
a resolver read at use time:

- `liveTranscriptionIntervalMs`, captured at `index.ts:684`.
- Overlay UI language and theme, frozen at boot.

### 4.4 Renderer state that never refreshes (ALSO FOUND, lane 10)

- `StatusCluster.tsx:59` and `DictateView.tsx:189` hardcode
  `parakeet-tdt-0.6b-v3-int8`, so a selected v2 is reported missing while
  main happily uses it. Read `settings.parakeetModelId`.
- `StatusCluster` snapshots the model list at mount; subscribe to the
  download-progress and settings channels it already has access to.
- The capture microphone dropdown reverts after a switch because
  `setDevice` is fire-and-forget with no reconciliation. Confirm the
  applied device back to the renderer.

### 4.5 Pre-roll is a dead setting (ALSO FOUND, lane 3)

`prerollMs` is written by `CaptureTab.tsx:263-269`, validated in the
schema, and **read by nothing in main**. The recorder hardcodes 250ms.
Either wire it through to the recorder or remove the control. Wire it:
the setting is documented product behaviour in AGENTS.md section 3.

**Wave 4 gate:** T2.

---

## Wave 5: correctness in engines, models and text

### 5.1 Parakeet decode is unbounded and mislabelled (ALSO FOUND, lane 5)

`src/main/engines/parakeet.ts`. Both defects are in code committed in
`76c59e5`, so this is fresh-code follow-up:

- The router's 20s local timeout and its `AbortSignal` do not reach the
  decode. `decodeAsync` cannot be cancelled, but the request can stop
  *waiting*: race the decode against the signal so the router can fall
  back, and make sure the queue is not held by an abandoned decode.
- `resolveModelId()` is read at result-build time (`:391`), so a model
  switched mid-decode writes the wrong model id into History. Capture the
  id at decode start and label the result with that.

### 5.2 Multi-file download reports success on failure (ALSO FOUND, lane 7)

`src/main/models/`. A failed multi-file download is reported `done`, the
error code is never surfaced, and the abort-others path is dead code. This
is how an engine claims ready and then fails at first use. Propagate the
per-file failure to the aggregate result and surface it in `ModelsView`.

### 5.3 Dictionary whole-word rules fail on non-ASCII (ALSO FOUND, lane 1)

`src/shared/dictionary.ts`. JavaScript `\b` is ASCII-only, so a rule whose
first or last character is accented or non-Latin never fires, in both the
preview and delivery. Replace the `\b` anchors with Unicode-aware
boundaries (lookarounds on `\p{L}\p{N}` with the `u` flag).

### 5.4 Meeting segment write failure escapes the worker listener (ALSO FOUND, lane 9)

Wrap the worker message listener's persistence call, same principle as
3.1: a failing optional write must not take down the process.

**Wave 5 gate:** T3 (engines and models touch native paths).

---

## Wave 7: the speech language never reaches the decoder

Raised by Roy during Wave 1, and **not found by any of the ten lanes**.
Found while proving it: this is a wiring gap, not a subtle race.

### 7.1 Dictation ignores the Speech Language setting entirely

`src/main/index.ts`, `src/main/engines/types.ts`

`TranscribeRequest` carries an optional `language` hint
(`engines/types.ts:12-13`). The **meeting** path sets it, normalized, at
`meeting/meeting-session.ts:374`. The **dictation** path never does: the
router call at `index.ts:576-580` passes `pcm` and `durationMs` and
nothing else.

Both cloud and Whisper engines already honour the field and are simply
never given it:

- `whisper-cpp.ts:214-215` pushes `-l <lang>` when `request.language` is
  set.
- `openrouter.ts:47-52` puts it in the request payload.

So the Speech Language setting influences exactly one thing in dictation:
which filler table runs **after** the transcript already exists
(`index.ts:610-616`). The decoder auto-detects per utterance regardless of
what the user selected. That is the mechanism behind the report Roy gave
from the app itself: clear Dutch speech coming back with English words in
it, and misheard words generally, because per-utterance auto-detect on
short dictation is far weaker than a pinned language.

Fix: pass the resolved language into the router call, treating `auto` as
"omit the hint" so auto-detect stays available for people who want it.
Parakeet has no language parameter (it is a fixed multilingual model), so
this changes Whisper and OpenRouter only, which is worth stating in the
UI rather than implying the setting binds every engine.

### 7.2 Speech language is never asked, and the default is wrong for most users

`src/renderer/main/onboarding/`, `src/shared/settings.ts:115`

Onboarding covers engine, microphone, hotkey and a try-it step. It never
asks what language the user speaks, and `speechLanguage` defaults to
`"auto"`. Most people dictate in one language, occasionally two (their own
and English), so `auto` is the worst default: it pays a detection penalty
on every utterance to serve a case most users never have.

- Add a speech language step to onboarding, defaulted from the OS
  preferred languages that `index.ts` already resolves for the UI locale
  at boot, so the common case is one confirming click.
- Keep `auto` available as an explicit choice, not the silent default.
- Note that UI language and speech language are independent axes
  (AGENTS.md section 16), so this step must not write `locale`.

### 7.3 Meetings should honour a per-meeting language

Same rationale, different surface: a meeting is long and single-language
far more often than dictation is. The meeting path already sends the
setting, so this is a UI question (confirm or override the language when
starting a meeting) rather than a wiring one. Lower priority than 7.1 and
7.2; do it once those land and we can see whether it is still needed.

**Wave 7 gate:** T2 for 7.1 and 7.3, T2 for 7.2. Worth a manual check in
Dutch and English before merging, since the whole point is output quality
that no unit test can assert.

---

## Wave 6: the unproven list

Do not write code against these. Convert each into a cheap experiment,
then either promote it into a wave or close it.

- **Model files without a published hash** (lane 7): check whether
  `tokens.txt` and friends are verified by existence alone. If so, a
  truncated vocab passes as installed. Decide whether to add hashes to the
  catalog. Likely real, cheap to establish.
- **OpenRouter `costUsd: null`** (lane 5): one live call with a real key
  settles it. Ask Roy to run it; it needs his key, and no agent should.
- **Archive tail dropped at stop** (lane 6): instrument the stop boundary
  and measure. If up to 5s of audio is genuinely lost, it promotes to
  Wave 3 severity.
- **Renderer death mid-recording** (lane 6): kill the meeting renderer
  with the task manager and observe. If the session stays `recording`
  forever, it is a real wedge.
- **Non-atomic secrets write** (lane 1): the same fix as 2.2, in
  `secrets.ts:59-79`. Cheap enough to just do during Wave 2 rather than
  investigate.
- **Dictionary concurrent writes** (lane 1): agreed, not reachable at
  human speed. Close it.
- **Lost key-up in the PTT hook** (lane 4): needs real-world drop data.
  Leave open, watch for user reports.

---

## Sequencing and risk

Waves 1, 2 and 4 are independent and can go in parallel. Wave 3 is the
risky one: 3.2 rewrites the meeting start/stop lifecycle and deserves its
own PR, its own review, and a manual meeting test on real hardware. Do not
bundle it with anything.

Ordering rationale: Wave 1 first because it is actively corrupting
delivered text and destroying clipboard content on every dictation for
affected users, and the fixes are small and self-contained. Wave 2 second
because every hour it stays broken is another chance for a truncated write
to eat a profile. Wave 3 third because it is the most invasive. Waves 4
and 5 are the long tail.

None of this is committed. Every wave lands on its own branch off
`fix/meeting-speaker-detection`, per the branch-per-change rule in
`github-workflow`, and the gate tier stated per wave decides who merges.

## What I have not done

The sweep's proofs are the agents', not mine. I verified the mechanism of
findings 1 through 10 by reading the cited code, and I re-ran nothing of
theirs. Before implementing any wave, the probe for that finding should be
re-run locally so the fix is written against a reproduction we have seen
ourselves.
