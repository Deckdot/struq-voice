# Struq Voice: design system

The single source of truth for the look and behavior of every surface in
Struq Voice. Every view, every component, every motion obeys this doc.

If you change a token, change it here. If you add a component, describe
the role and the contract here before writing the code.

## 1. Concept: Evergreen and Ember

The product is a serious Windows utility. It is not a consumer toy, not a
marketing site, not a generic AI dashboard. It is the tool a person
opens forty times a day to put words on the screen.

The visual system is named after the two colors that carry the meaning of
the whole product:

- **Evergreen (pine green)** is the light-theme accent. It marks primary
  actions, active navigation, focus rings, and selected controls.
- **Ember (terracotta)** is the dark-theme accent and the warm brand colour.
  It carries the same interaction roles without tinting the whole window
  green. Live capture uses a distinct verdigris semantic green, so recording
  remains unmistakable without competing with primary actions.

Surfaces are neutral and slightly temperature-shifted: warm porcelain in
light mode, cool graphite gray in dark mode. Elevation is
tonal, not shadow-based. Only two shadows exist in the whole product, and
both are reserved for surfaces that genuinely float above the OS
desktop: the capture pill, and the command palette.

## 2. Surfaces

Five levels, each one step lighter than the one beneath it in dark mode,
each one step darker than the one beneath it in light mode. A card on a
card on a card is a bug; the structure of the interface should not need
three nested surfaces to read.

| Token            | Light                       | Dark                        |
| ---------------- | --------------------------- | --------------------------- |
| `bg`             | `oklch(0.97 0.005 110)`      | `oklch(0.18 0.005 250)`      |
| `bg-sunken`      | `oklch(0.945 0.007 110)`     | `oklch(0.15 0.006 250)`     |
| `surface`        | `oklch(0.988 0.004 110)`     | `oklch(0.22 0.006 250)`     |
| `surface-hover`  | `oklch(0.962 0.006 110)`     | `oklch(0.255 0.007 250)`     |
| `surface-active` | `oklch(0.94 0.008 110)`      | `oklch(0.285 0.008 250)`     |

Window background anchors for the main process:
- Light: `#f4f3ee`
- Dark:  `#101214`

These match the bg tokens within tolerance and exist so the OS window
does not flash white before the renderer paints.

## 3. Text

| Token        | Color                                                  | Use                                  |
| ------------ | ------------------------------------------------------ | ------------------------------------ |
| `text`       | `oklch(0.26 0.02 155)` light / `oklch(0.93 ...)` dark  | Body, headings, the things that read |
| `text-secondary` | one step lighter                                  | Labels next to controls              |
| `text-muted` | one more step lighter                                  | Metadata, hints, timestamps          |
| `text-inverse` | flips to match the accent fill                       | Text that sits on an accent surface  |

Every numeric value, every timestamp, every model size uses tabular
numerals (`font-variant-numeric: tabular-nums`) so a running timer does
not twitch the layout.

## 4. Accent, ember, and semantics

- **accent**: evergreen in light mode and terracotta in dark mode. It marks
  primary actions, focus rings, and selected controls. Light:
  `oklch(0.45 0.085 160)`. Dark: `oklch(0.7 0.13 43)`. Hover and active
  states shift lightness only, never hue.
- **ember**: the warm brand color. The logo dot and restrained secondary
  details use it. Light: `oklch(0.56 0.115 42)`. Dark:
  `oklch(0.65 0.12 45)`.
- **semantics**: success, warning, danger, info. All four exist in both
  themes. Dark-theme `-soft` tokens resolve to opaque neutral surfaces,
  never transparent colour washes. Success uses verdigris rather than the
  common saturated green.

State is never communicated by color alone. Every state pairs a color
with either a word, a glyph, or both. The listening mark is an animated
verdigris bouncing ball plus the live waveform. The error dot is the
danger color plus a checkmark, an X, or a warning glyph.

## 5. Typography

Two families, self-hosted via Fontsource. No other family is permitted
in the renderer.

- **Urbanist** (`font-display`): page titles, section titles, modal
  titles, onboarding headlines, the large readiness statement. Light
  feel, geometric, confident.
- **Plus Jakarta Sans** (`font-sans`): every other piece of text.
  Navigation, buttons, body, labels, form controls, settings,
  descriptions, tables, badges, tooltips, empty states, metadata.

| Token        | Size / line height | Family and weight              |
| ------------ | ------------------ | ------------------------------ |
| `text-2xs`   | 11 / 14            | PJS 500 (kbd hints, micro)     |
| `text-xs`    | 12 / 16            | PJS 500 (metadata, labels)     |
| `text-sm`    | 13 / 18            | PJS 400 (UI default)           |
| `text-base`  | 14 / 20            | PJS 400 (body)                 |
| `text-md`    | 15 / 22            | PJS 400 (transcript reading)   |
| `text-lg`    | 17 / 24            | Urbanist 600 (section titles)  |
| `text-xl`    | 20 / 26            | Urbanist 600 (modal titles)    |
| `text-2xl`   | 26 / 32            | Urbanist 600 (view titles)     |

No text under 11px. Uppercase only for 11px tracking-wide group headers
and phase labels. No heavy bold weights everywhere: bold is for the
thing the eye should land on, and there is exactly one of those per
region.

## 6. Spacing, radius, elevation

- Spacing scale: 4px base. Allowed steps are 4, 8, 12, 16, 20, 24, 32,
  40, 48, 64. Use the named tokens, not raw values.
- Radius: `radius-sm` 4, `radius-md` 6, `radius-lg` 9, `radius-xl`
  12, `radius-pill` 999. Mixed radii within one composition read as
  assembled rather than designed. Use one radius per family of
  elements.
- Elevation: tonal surface steps plus hairlines. Two shadows exist
  and both are reserved: `shadow-lift` for popovers, menus, dialogs
  and the command palette; `shadow-float` for the floating capture
  pill only. Nothing else casts a shadow.
- Press feedback: scale 0.97 on buttons, switch thumbs, checkboxes. No
  hover scaling. Overshoot is rare and reserved for the confirmation
  of a successful action.

## 7. Iconography

One family, one style, one weight: Phosphor regular (`ph:`), served
through Iconify. The icon set is vendored into
`src/renderer/assets/icons/ph.json` by `scripts/vendor-phosphor-icons.mjs`
and registered once at module scope. The CSP blocks network icon
fetching, so the offline bundle is mandatory, not optional.

Whitelist (40 icons). Adding a new icon means adding it to the
whitelist in the vendoring script, running the script, and using the
exact name. The script fails loudly when a name is missing, so a typo
breaks the build, not the runtime.

`microphone`, `microphone-slash`, `wave-sine`, `gear`,
`clock-counter-clockwise`, `cube`, `download-simple`, `trash`, `copy`,
`check`, `check-circle`, `magnifying-glass`, `x`, `caret-right`,
`caret-down`, `keyboard`, `warning-circle`, `info`, `circle-notch`,
`arrow-clockwise`, `arrow-right`, `folder-open`, `hard-drive`, `key`,
`sun`, `moon`, `circle-half`, `plus`, `minus`, `square`, `pencil-simple`,
`swap`, `sliders-horizontal`, `monitor`, `clipboard-text`, `list-checks`,
`eraser`, `text-t`, `command`, `broom`.

Sizes:
- 16px is the default for navigation, list items, and inline actions.
- 20px for empty states.
- 24px for the capture pill icon (check, warning).

Rules:
- Pair unfamiliar icons with visible text labels. Icon-only controls
  must have an `aria-label` and a Tooltip.
- Never decorate with sparkle, rocket, or lightning icons. They are
  not in the whitelist and should never be added.
- No emoji.

## 8. Motion

A weighted, physical motion language. Motion communicates intent: an
entrance is unhurried, an exit is faster, a press is immediate.

| Token            | Cubic-bezier                                   | Use                                |
| ---------------- | ---------------------------------------------- | ---------------------------------- |
| `ease-enter`     | `cubic-bezier(0.16, 1, 0.3, 1)`               | entrances                          |
| `ease-micro`     | `cubic-bezier(0.25, 1, 0.5, 1)`               | controls, hovers                   |
| `ease-move`      | `cubic-bezier(0.76, 0, 0.24, 1)`              | position, layout                   |
| `ease-panel`     | `cubic-bezier(0.83, 0, 0.17, 1)`              | committed panels, dialogs          |
| `ease-exit`      | `cubic-bezier(0.7, 0, 0.84, 0)`               | exits, faster than entrances       |

Durations: press 120ms, hover 180ms, control 220ms, popover 260ms,
page 320ms, splash 650ms, capture morph 300ms.

Nothing loops unless it represents a genuinely continuous process: the
listening waveform, the live microphone meter, the download progress
bar, the title bar drag affordance.

`prefers-reduced-motion: reduce` removes the large transforms and the
overshoot, keeps the short opacity transitions, and turns the waveform
into a static hairline. Layout never collapses; the information
hierarchy is preserved.

## 9. Page transitions

The shell is stable. The content region changes. Transitions:
- Outgoing: opacity 0, translateY -8px, 160ms, ease-exit.
- Incoming: opacity 0 to 1, translateY 12px to 0, 320ms, ease-enter.
- Direction: forward (right) or back (left) is derived from the route
  order: dictate (0), history (1), models (2), settings (3). The
  indicator in the navigation rail glides between rows via a shared
  Motion `layoutId`.

The user always understands where they came from. The transition is
under 400ms in total.

## 10. Component inventory

Every UI element in the renderer is built from this set. The shared
layer lives in `src/renderer/main/components/ui/` and is re-exported
from `src/renderer/main/components/ui/index.ts`. Views import from the
barrel.

| Component          | Role                                            |
| ------------------ | ----------------------------------------------- |
| `Button`           | Primary, secondary, ghost, danger               |
| `IconButton`       | Square control with a Phosphor icon and tooltip  |
| `Badge`            | Tiny status chip with tone                      |
| `Kbd`              | A keycap, sized for inline or section use       |
| `Field`            | Label, hint, error, control                      |
| `SettingsGroup`    | One logical block of related settings           |
| `SettingsRow`      | A single labelled row inside a SettingsGroup    |
| `Switch`           | Toggle                                          |
| `Checkbox`         | Square check with drawn checkmark               |
| `RadioGroup`       | A list of radio options with icon and description |
| `Select`           | Native select, themed                            |
| `TextInput`        | Single-line text field with leading/trailing slots |
| `NumberInput`      | Number field that delivers a number to onChange  |
| `SearchInput`      | Search field with magnifier and clear           |
| `Slider`           | Horizontal track with weighted thumb            |
| `SegmentedControl` | A small group of mutually exclusive choices     |
| `Tabs`             | Horizontal or vertical tabs with a shared indicator |
| `Tooltip`          | Brief popper that explains an icon-only control |
| `Popover`          | A small panel anchored to a trigger             |
| `DropdownMenu`     | A menu of items                                  |
| `Dialog`           | Modal with focus trap and a small enter motion  |
| `Disclosure`       | A toggle that reveals content with height anim  |
| `ProgressBar`      | A thin progress bar, plus the `formatBytes` util |
| `Skeleton`         | A muted block used as a loading placeholder     |
| `EmptyState`       | A centered, image-free empty state              |
| `InlineError`      | A short, inline error with a warning glyph      |
| `StatusDot`        | A small filled dot that names a state           |
| `HotkeyRecorder`   | A two-mode control that records a new chord     |
| `TranscriptRow`    | One row in the History list                      |
| `ModelRow`         | One model in the catalog                         |
| `Card`             | A simple rounded surface                         |
| `Section`          | A heading plus content for one-off pages        |

Heights: sm 28, md 32, lg 40. Press scale 0.97. Focus: 2px accent
ring, 2px offset, `:focus-visible` only.

## 11. Microinteractions

The set every component uses. None of these are decoration.

- Button press: scale 0.97 in 120ms.
- Switch thumb: weighted translate 180ms, ease-micro.
- Checkbox checkmark: drawn with `stroke-dashoffset`, 180ms.
- Radio dot: scales 0.6 to 1 on selection, 160ms.
- Segmented control: shared `layoutId` indicator glides between
  options, 220ms.
- Tabs: shared underline glides, 280ms.
- Copy buttons: morph to a check icon and a "Copied" label for 1.2s.
- Download action: morphs into an in-place progress bar with
  transferred bytes, total, and a percent.
- Hotkey recorder: dashed accent border while listening.
- Disclosure chevron: rotates 90 degrees on the same curve as the
  height animation.
- Hover on a list row: the action slot is reserved at 72px wide so the
  row never shifts when a mouse enters.
- Command palette: opens with scale 0.98 to 1 and y -8 to 0 settle,
  260ms.
- Theme change: 200ms blend on `html, body` for background-color and
  color, gated by a `.theme-ready` class so the first paint is not
  animated.
- Download completion: a small check morph, no toast.

## 12. Voice and copy rules

Struq Voice is for normal people, not developers. Every word on the
screen should pass the "would I say this to my mother" test.

- "Voice service" or "voice helper", never "engine".
- "Local" or "on this computer", never "local" without context.
- "Cloud" or "online", but always with a plain sentence: "Your audio
  leaves this computer."
- "Words to fix" or "dictionary", never "lookup table".
- "Voice helper" or "helper", never "runtime".
- "Helper", never "whisper-cli" or "binary".
- "Speed", never "RTF" or "real-time factor".
- "Languages" and the count, never "locale list".
- "Hold to record" and "press to toggle", never "PTT" or "toggle".
- "Open the tray" or "close the window keeps Struq Voice running",
  never "background mode".
- "Check for updates" with a state line, never a spinner.
- "No API key configured" and "Add a key" as the fix, never a raw
  error.
- "Struq Voice can't hear your microphone" and a fix, never a
  "device error" toast.
- Spell out a reason next to a fix. Never send the user to Settings
  with a generic "something went wrong."
- Internal model names (Parakeet, Whisper) are fine when introduced
  as the name of the thing doing the work. Do not turn them into
  acronyms.

## 13. Accessibility

- WCAG AA contrast across every token pair.
- Full keyboard navigation with a visible 2px accent focus ring on
  `:focus-visible` only.
- Logical tab order. The shell, the rail, the content region, in
  that order.
- Escape dismisses every transient surface (popover, menu, dialog,
  command palette).
- Enter and Space activate the focused control.
- Dialogs trap focus. Radix provides this; trust the default.
- The capture pill never takes focus and never traps it. The
  application receiving the paste must be the focused app.
- The capture pill has a `role` of nothing and `tabindex` of -1.
  Keyboard focus stays in the dictation source.
- All icon-only controls have an `aria-label` and a Tooltip.
- All numeric data is `data-numeric` so it picks up tabular figures.
- Comfortable pointer targets: 28px minimum, 32px default.
- Reduced motion is honored structurally. The waveform still
  communicates "listening" without animation; the page transition
  becomes a soft opacity swap.
- `prefers-reduced-motion: reduce` shortens everything to opacity and
  removes the splash animation.

## 14. Application shell

The persistent frame every view renders into:

- Custom title bar (40px), drag region on the left and centre, the
  minimise, maximise, and close controls on the right. The close
  control uses the danger surface on hover, matching the Windows
  convention. Double-click on the drag region toggles maximise.
- Left navigation rail (200px). Dictate, History, and Models sit at the top.
  Settings is pinned to the bottom. The active item carries a 3px accent edge
  that glides between rows. A fault status appears just above Settings only
  when the user needs to act.
- A flexible content region on the right. Pages transition in and
  out with the page transition spec.
- The status cluster, the command palette, the splash, and the update
  prompt are overlays mounted at the App root.

## 15. Capture overlay

The floating pill that appears while a capture is in flight. The most
frequently seen surface in the product, and the one that needs the
highest craft.

- 280 wide, 48 tall when the live transcript is off, 150 when it is on.
- Opaque themed surface, hairline border, `shadow-float`.
- Draggable anywhere; the renderer tracks the pointer and sends
  absolute screen coordinates through the `overlay:move` channel. Main
  clamps to a live display and remembers the position across restarts.
- Five states with object continuity on the same canvas: arming,
  listening, transcribing, delivering, error.
  - Arming: accent dot, idle baseline.
  - Listening: verdigris bouncing ball, matching live waveform, elapsed time.
  - Transcribing: bars decay into a thin processing line with one
    controlled shimmer sweep, engine label on the right. No spinner.
  - Delivering: check draws itself in the success colour. No text competes
    with the final confirmation.
  - Error: danger dot, cause, "Copied. Press Ctrl + V." when the
    text survived.
- The cold-start replay path in main is preserved: the broadcast
  that started the capture is replayed on `did-finish-load`, so the
  first capture of a fresh session shows the right state immediately.
- The overlay window stays `focusable: false`. The OS foreground
  window never changes while a capture is in flight.

## 16. Onboarding

Five moments for a first run, in order:

1. **Microphone** arrives satisfied. The live meter is the proof.
2. **Keys** shows the hold and toggle chords, both already
   registered. Change them if they clash.
3. **Model** is the recommendation for this computer. The download
   started when onboarding mounted, not when this step appeared.
4. **Try it** is the emotional peak. The user holds the key, says a
   sentence, releases. The result appears in the same step.
5. **Done** is a calm completion. A drawn check, "You are ready," a
   shortcut reminder, one primary button.

Skipping is always available, defaults are already applied, and
completion is recorded in `settings.onboarding.completed`.

## 17. Tokens at a glance

The full palette, in one place, so a new view does not have to guess.

| Group            | Tokens                                                    |
| ---------------- | --------------------------------------------------------- |
| Surfaces         | `bg`, `bg-sunken`, `surface`, `surface-hover`, `surface-active` |
| Text             | `text`, `text-secondary`, `text-muted`, `text-inverse`     |
| Border           | `border`, `border-strong`                                 |
| Accent           | `accent`, `accent-solid`, `accent-solid-hover`, `accent-solid-active`, `accent-text`, `accent-soft` |
| Ember            | `ember`, `ember-soft`                                     |
| Semantics        | `success`, `success-soft`, `warning`, `warning-soft`, `danger`, `danger-soft`, `info`, `info-soft` |
| State            | `state-idle`, `state-arming`, `state-listening`, `state-transcribing`, `state-delivered`, `state-error` |
| Type             | `font-display`, `font-sans`, `text-2xs`, `text-xs`, `text-sm`, `text-base`, `text-md`, `text-lg`, `text-xl`, `text-2xl` |
| Radius           | `radius-sm`, `radius-md`, `radius-lg`, `radius-xl`, `radius-pill` |
| Spacing          | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64                      |
| Shadows          | `shadow-lift`, `shadow-float`                             |
| Motion           | `ease-enter`, `ease-micro`, `ease-move`, `ease-panel`, `ease-exit`, plus the duration scale |

Every view uses only these tokens. Anything outside this list is a
defect.
