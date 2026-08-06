# Implementation plan: curtain reveal, chart draw-in, History performance, Dictionary tab

Hand-off document. Everything below has been read against the current tree at
branch `v3` (HEAD `906b128`). File paths, prop signatures and token names are
verified, not assumed. Work the four sections in order; they are independent
except that WS1 introduces the `shellRevealed` store flag that WS2 consumes.

**House rules that apply to every line you write here:**

- No em dashes (U+2014), en dashes (U+2013) or horizontal bars (U+2015).
  Anywhere. Use commas, colons, parentheses, or two sentences.
- Comments only when they carry information. Match the header doc-comment
  style already in each file.
- The renderer never imports from `src/main/`.
- Every IPC channel is declared in `src/shared/ipc.ts` and nowhere else.
- `src/shared/` has no side effects and no Electron imports.
- TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Gate with `pnpm typecheck && pnpm lint && pnpm test`. Do **not** run
  `pnpm test:e2e` unprompted.

---

## Table of contents

- [WS1: Curtain reveal when the splash finishes](#ws1-curtain-reveal-when-the-splash-finishes)
- [WS2: Weighted draw-in for the activity chart](#ws2-weighted-draw-in-for-the-activity-chart)
- [WS3: History view is laggy, root causes and fixes](#ws3-history-view-is-laggy-root-causes-and-fixes)
- [WS4: The Dictionary tab](#ws4-the-dictionary-tab)
- [Final gate checklist](#final-gate-checklist)

---

# WS1: Curtain reveal when the splash finishes

## What is there now

`src/renderer/main/components/Splash.tsx` covers the shell with a `bg-bg`
panel holding `BrandMarkAnimated`, waits 1300ms, then exits with
`opacity: 0, scale: 1.03`. A fade-and-scale exit is the weakest possible
handoff: nothing travels, so the app does not feel like it arrives, it feels
like the splash gave up.

## What to build

The canonical two-sheet curtain. A front sheet carrying the mark lifts
upward, and a second sheet lags it by 90ms so a band of accent sweeps up the
screen behind the first. The shell rises 14px into the space the curtain
vacates, overlapping the lift rather than waiting for it.

Timing budget (once per window session, gated by `sessionStorage`):

| Phase | Duration | Ease | Transform |
|---|---|---|---|
| Mark hold | 980ms | (the mark's own stagger runs ~900ms) | none |
| Front sheet lift | 640ms | `cubic-bezier(0.83, 0, 0.17, 1)` | `y: 0% -> -100%` |
| Trailing sheet lift | 640ms, delay 90ms | same | `y: 0% -> -100%` |
| Mark fade | 260ms | `cubic-bezier(0.7, 0, 0.84, 0)` | opacity |
| Shell rise | 720ms, delay 180ms | `cubic-bezier(0.16, 1, 0.3, 1)` | `y: 14px -> 0`, opacity |
| Reduced motion | 300ms | linear | opacity only, no travel |

Total to a usable window: ~1.7s on first launch of a session, 0ms after.

Why the trailing sheet is `bg-accent-soft`: in light mode that token is
`oklch(0.94 0.022 160)` against a `oklch(0.97 0.005 110)` page, a visible
green-tinted step. In dark mode `--sv-accent-soft` resolves to
`--sv-surface-active` (`oklch(0.285 ...)`) against `--sv-bg`
(`oklch(0.18 ...)`), which is a clear tonal step. Both palettes read. Do not
substitute an alpha fill; the theme contract forbids translucent soft tokens.

## Step 1.1: add the reveal flag to the store

File: `src/renderer/main/store/use-main-store.ts`

Add to `MainWindowState`, after `themeMode`:

```ts
  /**
   * True once the splash curtain has started to lift. Views that own an
   * entrance animation read it so their motion is not spent behind a cover.
   */
  shellRevealed: boolean;
```

Add to the setters block, after `setThemeMode`:

```ts
  setShellRevealed: (next: boolean) => void;
```

Add to the `create` body, after `themeMode: "system",`:

```ts
  shellRevealed: false,
```

and after the `setThemeMode` implementation:

```ts
  setShellRevealed: (shellRevealed) => {
    set({ shellRevealed });
  },
```

## Step 1.2: rewrite the splash

File: `src/renderer/main/components/Splash.tsx`

Replace the entire file with:

```tsx
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { motion } from "motion/react";
import type { Variants } from "motion/react";
import { useReducedMotion } from "motion/react";
import { BrandMark, BrandMarkAnimated } from "./Brand";

const SPLASH_KEY = "struq.splash.v1";

/** Whether the splash has already played in this window session. */
export const splashSeen = (): boolean => {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(SPLASH_KEY) !== null;
  } catch {
    return false;
  }
};

/** How long the mark holds before the curtain starts. The mark's own bar
 *  stagger finishes at ~900ms, so the hold ends the moment it settles. */
const HOLD_MS = 980;
const REDUCED_HOLD_MS = 600;

/** --ease-panel. Holds, then commits: the cinematic door. */
const CURTAIN_EASE = [0.83, 0, 0.17, 1] as const;
/** --ease-exit. */
const EXIT_EASE = [0.7, 0, 0.84, 0] as const;

const FRONT_SHEET: Variants = {
  held: { y: "0%" },
  lifted: { y: "-100%", transition: { duration: 0.64, ease: CURTAIN_EASE } }
};

/** Lags the front sheet, so a band of accent passes over the shell. */
const TRAILING_SHEET: Variants = {
  held: { y: "0%" },
  lifted: { y: "-100%", transition: { duration: 0.64, delay: 0.09, ease: CURTAIN_EASE } }
};

const MARK: Variants = {
  held: { opacity: 1 },
  lifted: { opacity: 0, transition: { duration: 0.26, ease: EXIT_EASE } }
};

export interface SplashProps {
  /**
   * Fires the moment the curtain starts to lift, not when it finishes, so
   * the shell rises in the curtain's wake instead of after it.
   */
  readonly onReveal: () => void;
}

/**
 * The first-paint cover. It holds the brand mark while the theme settles,
 * then lifts as a two-sheet curtain and unmounts. Shown once per window
 * session: the sessionStorage gate makes every later mount a no-op.
 */
export function Splash({ onReveal }: SplashProps): JSX.Element | null {
  const reduced = useReducedMotion() === true;
  const [state, setState] = useState<"shown" | "lifting" | "gone">(() =>
    splashSeen() ? "gone" : "shown"
  );

  // The callback is held in a ref so an inline arrow from the caller cannot
  // restart the hold timer on every render.
  const revealRef = useRef(onReveal);
  useEffect(() => {
    revealRef.current = onReveal;
  }, [onReveal]);

  useEffect(() => {
    if (state === "gone") {
      revealRef.current();
      return;
    }
    if (state !== "shown") return;
    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      // Private mode or a locked-down profile: the splash simply plays again.
    }
    const timer = window.setTimeout(
      () => {
        setState("lifting");
        revealRef.current();
      },
      reduced ? REDUCED_HOLD_MS : HOLD_MS
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [reduced, state]);

  if (state === "gone") return null;

  if (reduced) {
    return (
      <motion.div
        className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg"
        initial={{ opacity: 1 }}
        animate={{ opacity: state === "lifting" ? 0 : 1 }}
        transition={{ duration: 0.3, ease: "linear" }}
        onAnimationComplete={() => {
          if (state === "lifting") setState("gone");
        }}
        aria-hidden="true"
      >
        <BrandMark size={64} className="text-accent" />
      </motion.div>
    );
  }

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      initial="held"
      animate={state === "lifting" ? "lifted" : "held"}
      aria-hidden="true"
    >
      <motion.div
        variants={TRAILING_SHEET}
        className="absolute inset-0 bg-accent-soft"
        onAnimationComplete={() => {
          if (state === "lifting") setState("gone");
        }}
      />
      <motion.div
        variants={FRONT_SHEET}
        className="absolute inset-0 flex items-center justify-center bg-bg"
      >
        <motion.span variants={MARK} className="inline-flex">
          <BrandMarkAnimated size={64} className="text-accent" />
        </motion.span>
      </motion.div>
    </motion.div>
  );
}
```

Points the implementer must not get wrong:

1. **DOM order is the z-order.** The trailing sheet is first (behind), the
   front sheet second (on top). Swap them and the accent band never appears.
2. **`onAnimationComplete` goes on the trailing sheet**, which finishes last
   (0.09 + 0.64 = 730ms). Putting it on the front sheet cuts the trailing
   sheet off at 640ms.
3. `AnimatePresence` is deliberately gone. The unmount is driven by the
   variant completing, which is deterministic; wrapping two independently
   delayed sheets in a presence exit is where this pattern usually breaks.
4. React `StrictMode` is on (`src/renderer/main/main.tsx:89`). The effect will
   run, clean up, and run again. Writing the same sessionStorage key twice is
   idempotent and the timer is cleared on cleanup, so this is safe.

## Step 1.3: wire the shell entrance

File: `src/renderer/main/App.tsx`

Add `useCallback` to the React import. Add these variant constants below
`REDUCED_PAGE_VARIANTS`:

```tsx
/**
 * The shell rises into the space the curtain vacates. The delay overlaps the
 * lift rather than queueing behind it, so the two read as one gesture.
 */
const SHELL_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 14 },
  revealed: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.72, delay: 0.18, ease: [0.16, 1, 0.3, 1] }
  }
};

const REDUCED_SHELL_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  revealed: { opacity: 1, transition: { duration: 0.25 } }
};
```

Inside `App()`, add after the `capture` selector:

```tsx
  const shellRevealed = useMainStore((state) => state.shellRevealed);
  const setShellRevealed = useMainStore((state) => state.setShellRevealed);
  const handleReveal = useCallback(() => {
    setShellRevealed(true);
  }, [setShellRevealed]);
```

Change the JSX. Current shape (`src/renderer/main/App.tsx:95-134`):

```
<div className="flex h-full flex-col bg-bg text-text">
  <Splash />
  <TitleBar />
  {onboarding ? <Onboarding .../> : <div className="flex min-h-0 flex-1">...</div>}
  ...
```

Target shape:

```tsx
    <div className="flex h-full flex-col bg-bg text-text">
      <Splash onReveal={handleReveal} />
      <TitleBar />
      <motion.div
        className="flex min-h-0 flex-1 flex-col"
        variants={reducedMotion === true ? REDUCED_SHELL_VARIANTS : SHELL_VARIANTS}
        initial="hidden"
        animate={shellRevealed ? "revealed" : "hidden"}
      >
        {onboarding ? (
          <Onboarding ... unchanged ... />
        ) : (
          <div className="flex min-h-0 flex-1">
            <Rail />
            <main className="relative min-h-0 flex-1 overflow-hidden bg-bg" data-selectable>
              ... unchanged ...
            </main>
          </div>
        )}
      </motion.div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      {!onboarding && <UpdateDialog api={api} />}
    </div>
```

Why this exact nesting:

- The `TitleBar` stays **outside** the animated wrapper. It carries
  `-webkit-app-region: drag`; a transformed ancestor changes hit testing for
  app regions in Electron and the window stops being draggable.
- The wrapper is `flex min-h-0 flex-1 flex-col`. Both branches already root at
  `flex min-h-0 flex-1` (`Onboarding.tsx:145` and `:171`), so they grow
  correctly inside a column flex parent.
- `CommandPalette` and `UpdateDialog` stay outside. Both are `fixed` /
  Radix-portalled, and a transformed ancestor would become their containing
  block.

## Step 1.4: while you are in App.tsx, fix the page transition mode

Same file, line 111. Change:

```tsx
<AnimatePresence mode="popLayout" initial={false} custom={routeDirection}>
```

to:

```tsx
<AnimatePresence mode="wait" initial={false} custom={routeDirection}>
```

`popLayout` takes the exiting page out of flow with `position: absolute` and
measures it against the entering one. On History that means measuring a
virtualized list mid-teardown, which is a route-change stutter for no visual
gain. `mode="wait"` costs a 160ms exit before the 320ms enter and removes the
projection work entirely.

## Step 1.5: add the new motion tokens

File: `src/renderer/styles/theme.css`, inside `@theme inline`, after
`--ease-exit`:

```css
  --ease-draw: cubic-bezier(0.34, 0.05, 0.2, 1);
```

and after `--duration-splash`:

```css
  --duration-curtain: 640ms;
  --duration-draw: 1600ms;
```

These document the system. TSX keeps using the numeric arrays (that is already
how `App.tsx` and `Splash.tsx` reference `--ease-enter`), so keep the two in
sync by hand.

## WS1 acceptance

- `pnpm dev`, first launch of the session: the mark holds, then a curtain
  lifts with a visible accent band trailing it, and the shell rises into
  place. Verify in **both** themes.
- Drag the title bar. The window still moves.
- Ctrl+K opens the palette centred and unclipped.
- OS setting "Show animations in Windows" off: the splash fades in 300ms with
  no travel, the shell fades in, nothing slides.
- Reload (Ctrl+R in dev): no splash at all, shell visible immediately, no
  flash of a hidden shell (the `gone` branch calls `onReveal` in its effect).

---

# WS2: Weighted draw-in for the activity chart

## What is there now

`src/renderer/main/components/HistoryChart.tsx` renders a recharts `AreaChart`
with two `Area` series. Three real problems:

1. **`chartData` is rebuilt on every render** (line 74), so recharts sees a new
   data array identity every time the parent re-renders and restarts its
   animation. `DictateView` refetches stats on every `capture.phase` change
   (line 90-98), so the chart re-animates after every dictation, and again on
   every unrelated parent render.
2. **The animation plays behind the splash.** DictateView is the landing
   route, so the chart mounts at boot and its 1300/1500ms draw is over by the
   time the curtain lifts at ~1.7s. The user never sees it.
3. The easing string does work at runtime (recharts `parseCubicBezier` in
   `node_modules/recharts/es6/animation/easing.js` handles
   `cubic-bezier(...)` and `parseFloat` tolerates the spaces), but expo-out on
   a clip wipe spends 80% of the duration covering the last 15% of the
   distance. It reads as "snap, then creep", which is the opposite of
   weighted.

## The mechanic, so you know what you are tuning

Recharts 3 animates an `Area` through `AreaRevealShape`, which renders a
`HorizontalClipRect` whose `width = alpha * |startX - endX|`
(`node_modules/recharts/es6/cartesian/AreaRevealShape.js`). The stroke and
the gradient fill are revealed together, left to right, by a clip. That is a
genuine draw. You are shaping the velocity of the clip front, not adding a
new mechanic.

## Step 2.1: gate the chart on the curtain

File: `src/renderer/main/views/DictateView.tsx`

Add to the imports (`useMainStore` is already imported at line 4). Inside
`DictateView()`, after the `capture` selector:

```tsx
  const shellRevealed = useMainStore((state) => state.shellRevealed);
```

Then change the skeleton condition at line 205. Current:

```tsx
        {!statsLoaded ? (
```

Target:

```tsx
        {!statsLoaded || !shellRevealed ? (
```

The existing `Skeleton` block already reserves the exact height, so the
handoff is a skeleton that becomes a drawing chart with no layout shift.

## Step 2.2: rewrite the chart

File: `src/renderer/main/components/HistoryChart.tsx`

Replace the entire file with:

```tsx
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { motion } from "motion/react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from "recharts";
import type { HistoryStatsDay } from "../../../shared/ipc";

/**
 * The activity chart. The entrance is a weighted draw: recharts reveals each
 * area through a clip rect that sweeps left to right, so the curve appears to
 * be drawn rather than faded in.
 *
 * The easing is deliberately not the expo-out used elsewhere. On a clip sweep
 * expo spends most of its duration on the last sliver of distance, which reads
 * as a snap followed by a crawl. --ease-draw is a soft S: it leaves slowly,
 * carries momentum through the middle, and settles long.
 *
 * The long draw is an entrance, not an update. Once it has played, later data
 * changes interpolate over 420ms so a fresh transcript does not restage the
 * whole chart.
 */

/** --ease-draw. Keep in sync with theme.css. No spaces: the recharts
 *  EasingInput template literal type is happier without them. */
const DRAW_EASE = "cubic-bezier(0.34,0.05,0.2,1)" as const;
const UPDATE_EASE = "ease-out" as const;

const WORDS_DRAW_MS = 1500;
const WORDS_BEGIN_MS = 120;
const SPOKEN_DRAW_MS = 1750;
const SPOKEN_BEGIN_MS = 360;
const UPDATE_MS = 420;

/** When the entrance is over and later renders become plain updates. */
const DRAW_SETTLED_MS = SPOKEN_BEGIN_MS + SPOKEN_DRAW_MS + 120;

export interface HistoryChartProps {
  readonly days: readonly HistoryStatsDay[];
  readonly className?: string;
}

interface ChartItem {
  readonly dateStr: string;
  readonly fullDateStr: string;
  readonly words: number;
  readonly durationSec: number;
  readonly durationMin: number;
}

interface TooltipPayloadItem {
  readonly payload?: ChartItem;
}

interface CustomTooltipProps {
  readonly active?: boolean;
  readonly payload?: readonly TooltipPayloadItem[];
  readonly label?: string;
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" });
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric"
});

function CustomTooltip({ active, payload }: CustomTooltipProps): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0]?.payload;
  if (!data) return null;

  const formatMin = (sec: number): string => {
    if (sec < 60) return `${String(sec)}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m)}m ${String(s)}s`;
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 shadow-lg backdrop-blur-md">
      <p className="text-2xs font-normal text-text-muted">{data.fullDateStr}</p>
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-text-muted">Words:</span>
          <span className="font-normal text-text tabular-nums" data-numeric>
            {data.words.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-info" />
          <span className="text-text-muted">Spoken:</span>
          <span className="font-normal text-text tabular-nums" data-numeric>
            {formatMin(data.durationSec)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function HistoryChart({ days, className = "" }: HistoryChartProps): JSX.Element {
  // Gradient ids are document-global. Two charts on one page would otherwise
  // share one gradient and the second would inherit the first's stops.
  const gradientId = useId().replace(/:/g, "");
  const wordsGradient = `sv-words-${gradientId}`;
  const durationGradient = `sv-duration-${gradientId}`;

  const chartData: ChartItem[] = useMemo(
    () =>
      days.map((d) => {
        const durationSec = Math.round(d.durationMs / 1000);
        return {
          dateStr: shortDate.format(d.dayStartMs),
          fullDateStr: longDate.format(d.dayStartMs),
          words: d.words,
          durationSec,
          durationMin: Number((durationSec / 60).toFixed(1))
        };
      }),
    [days]
  );

  const [drawing, setDrawing] = useState(true);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const timer = window.setTimeout(() => {
      setDrawing(false);
    }, DRAW_SETTLED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`w-full h-44 ${className}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={wordsGradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--sv-accent)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--sv-accent)" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id={durationGradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--sv-info)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--sv-info)" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--sv-border)"
            opacity={0.4}
            vertical={false}
          />
          <XAxis
            dataKey="dateStr"
            stroke="var(--sv-text-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            dy={4}
          />
          <YAxis
            yAxisId="words"
            stroke="var(--sv-text-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            dx={-4}
          />
          <YAxis
            yAxisId="duration"
            orientation="right"
            stroke="var(--sv-text-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            dx={4}
            hide
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "var(--sv-border-strong)", strokeWidth: 1 }}
          />
          <Area
            yAxisId="words"
            type="monotone"
            dataKey="words"
            name="Words Spoken"
            stroke="var(--sv-accent)"
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#${wordsGradient})`}
            isAnimationActive={true}
            animationBegin={drawing ? WORDS_BEGIN_MS : 0}
            animationDuration={drawing ? WORDS_DRAW_MS : UPDATE_MS}
            animationEasing={drawing ? DRAW_EASE : UPDATE_EASE}
          />
          <Area
            yAxisId="duration"
            type="monotone"
            dataKey="durationMin"
            name="Minutes Spoken"
            stroke="var(--sv-info)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            fillOpacity={1}
            fill={`url(#${durationGradient})`}
            isAnimationActive={true}
            animationBegin={drawing ? SPOKEN_BEGIN_MS : 0}
            animationDuration={drawing ? SPOKEN_DRAW_MS : UPDATE_MS}
            animationEasing={drawing ? DRAW_EASE : UPDATE_EASE}
          />
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
```

Notes:

- `Intl.DateTimeFormat` instances are hoisted to module scope. `toLocaleDateString`
  builds a fresh formatter on every call; over 30 days that is 60 formatter
  constructions per render. This file is renderer-only so a module-level
  construction is fine (the no-side-effects rule applies to `src/shared/`).
- If `animationEasing` fails to typecheck, the type is
  `EasingInput = NamedBezier | 'spring' | EasingFunction` where `NamedBezier`
  includes the template literal
  `` `cubic-bezier(${number},${number},${number},${number})` ``
  (`node_modules/recharts/types/animation/easing.d.ts:3`). Keep the string free
  of spaces and it matches exactly.

## WS2 acceptance

- Cold start with at least one transcript in history: the skeleton holds until
  the curtain lifts, then the accent area draws in over ~1.5s with the dashed
  info line following ~240ms behind. The front of the sweep should never look
  like it stalls.
- Dictate something. The chart updates in 420ms without restaging the draw.
- Navigate away and back to Dictate. The full draw replays (mount entrance,
  intended).
- No console warning from recharts about an unrecognised easing.

---

# WS3: History view is laggy, root causes and fixes

## Diagnosis

The virtualizer calls `setState` on every scroll event, so **everything in
`HistoryView`'s render body runs at scroll frequency**. Seven separate costs
compound in that hot path.

| # | Cause | File / line | Cost |
|---|---|---|---|
| 1 | `groupRecords(records, now)` runs unmemoized on every render, allocating ~510 objects for a 500-row load | `HistoryView.tsx:86-87` | Highest. Per scroll frame. |
| 2 | `formatAbsoluteTime` calls `toLocaleString` and `formatRelativeTime` can call `toLocaleDateString`, each building a fresh `Intl.DateTimeFormat` | `lib/format.ts:15-32`, used per row | Very high. ~30 rows x 2 Intl constructions per frame. |
| 3 | `memo(TranscriptRow)` never hits: all six callbacks are new inline closures on every render | `HistoryView.tsx:304-331` | High. All visible rows fully re-render per frame, including `<Icon>` and two `tailwind-merge` calls each. |
| 4 | Custom `measureElement: (element) => element.offsetHeight` forces a synchronous layout inside the ResizeObserver callback, and drops subpixel height | `HistoryView.tsx:168` | High. Defeats TanStack's `borderBoxSize` fast path. |
| 5 | `rowIndices` maps and filters the full entry list twice, unmemoized | `HistoryView.tsx:173-176` | Medium. Per frame. |
| 6 | `willChange: "transform"` on every virtual item promotes ~31 composited layers (overscan 12 both directions) | `HistoryView.tsx:278` and `:301` | Medium. GPU memory plus raster, for no benefit: items do not move during a scroll, the container does. |
| 7 | `getItemKey` and `estimateSize` are new closures each render, invalidating TanStack's internal memos | `HistoryView.tsx:166-167` | Low, but free to fix. |

The **"scrolls very badly"** symptom specifically is #4 plus an estimate that
is off. `ROW_HEIGHT` is 88 while a real row measures ~93 (`px-4 py-3` = 24,
two lines at `text-sm`/`leading-snug` = ~35, `mt-1.5` = 6, meta line = ~18,
1px borders, plus the wrapper's 8px `paddingBottom`). Every newly measured row
grows `getTotalSize()` under the scrollbar, so the thumb resizes and content
shifts while the user drags.

**Two bugs found along the way, fix both:**

- Clearing the search never restores the full list. The search effect returns
  early on an empty query (`HistoryView.tsx:106`) and the initial load effect
  only depends on `[api]`, so the filtered records stay on screen.
- `mode="popLayout"` in `App.tsx` (fixed in WS1 step 1.4) measures the
  virtualized list during route teardown.

## Step 3.1: cache the Intl formatters

File: `src/renderer/main/lib/format.ts`

Replace the whole file with:

```ts
/**
 * Display formatters shared by the dashboard and History, so a timestamp
 * reads the same in both places.
 *
 * The Intl formatters are built once at module load. toLocaleString builds a
 * fresh formatter on every call, and History formats two timestamps per row
 * on every scroll frame, which made it the single most expensive thing in
 * that list.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const shortDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric"
});

const absoluteFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const dayHeadingFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric"
});

/**
 * "just now", "4m", "3h", "2d", then a calendar date once relative time
 * stops being the faster read. Deliberately terse: this sits at the end of a
 * row where the transcript is what matters.
 */
export const formatRelativeTime = (epochMs: number, now = Date.now()): string => {
  const elapsed = now - epochMs;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${String(Math.floor(elapsed / MINUTE))}m`;
  if (elapsed < DAY) return `${String(Math.floor(elapsed / HOUR))}h`;
  if (elapsed < 7 * DAY) return `${String(Math.floor(elapsed / DAY))}d`;
  return shortDateFormat.format(epochMs);
};

/** The unabbreviated timestamp, for the title attribute behind the short one. */
export const formatAbsoluteTime = (epochMs: number): string => absoluteFormat.format(epochMs);

/** The day separator in History: "Monday, March 3". */
export const formatDayHeading = (epochMs: number): string => dayHeadingFormat.format(epochMs);

/** Word count for display. Matches the SQL counter in the history store. */
export const countWords = (text: string): number => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
};
```

## Step 3.2: make TranscriptRow's memo actually work

File: `src/renderer/main/components/ui/TranscriptRow.tsx`

The callbacks must not close over the record, or the parent cannot hold them
stable. Change the prop signatures to pass the id back up, and fold
`onArmCopy` into `onCopy` (the parent did both on every copy anyway).

Replace `TranscriptRowProps` and the component body's derived values:

```tsx
export interface TranscriptRowProps {
  readonly record: TranscriptRecord;
  readonly focused: boolean;
  readonly expanded: boolean;
  readonly copyArmed: boolean;
  readonly deleteArmed: boolean;
  readonly onToggleExpanded: (id: number) => void;
  readonly onCopy: (id: number, text: string) => void;
  readonly onArmDelete: (id: number) => void;
  readonly onConfirmDelete: (id: number) => void;
  readonly onCancelArmedDelete: () => void;
}
```

Inside the component, before the return:

```tsx
  const { words, relative, absolute, iso } = useMemo(
    () => ({
      words: countWords(record.text),
      relative: formatRelativeTime(record.createdAtMs),
      absolute: formatAbsoluteTime(record.createdAtMs),
      iso: new Date(record.createdAtMs).toISOString()
    }),
    [record]
  );
```

Import `useMemo` from react. Then in the JSX:

- `onClick={onToggleExpanded}` becomes
  `onClick={() => { onToggleExpanded(record.id); }}`
- `<time dateTime={new Date(record.createdAtMs).toISOString()} title={formatAbsoluteTime(record.createdAtMs)}>{formatRelativeTime(record.createdAtMs)}</time>`
  becomes `<time dateTime={iso} title={absolute}>{relative}</time>`
- The copy `IconButton`'s `onClick` becomes
  `() => { onCopy(record.id, record.text); }`
- The delete confirm button's `onClick` becomes
  `() => { onConfirmDelete(record.id); }`
- The delete arm `IconButton`'s `onClick` becomes
  `() => { onArmDelete(record.id); }`
- `onBlur={onCancelArmedDelete}` stays as it is.

Inline arrows in the JSX are fine: they are inside the memoized component, so
they are recreated only when that row actually re-renders.

## Step 3.3: rewrite HistoryView

File: `src/renderer/main/views/HistoryView.tsx`

Replace the entire file with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MainWindowApi } from "../../../shared/api";
import type { TranscriptRecord } from "../../../shared/ipc";
import { EmptyState, SearchInput, TranscriptRow } from "../components/ui";
import { formatDayHeading } from "../lib/format";

const SEARCH_INPUT_ID = "history-search";

/**
 * The History view. Every transcript Struq Voice has produced, searched
 * through the keyboard or the search field. Rows are virtualized because
 * a long-running user has thousands; the row's transcript text is the
 * thing the eye should find first, so it is the dominant element, with
 * the date and engine as quiet metadata.
 *
 * The virtualizer re-renders this component on every scroll event, so
 * everything in the render body is scroll-frequency work. Grouping, the row
 * index table and every handler are memoized for that reason, not for tidiness.
 */

interface GroupHeader {
  readonly kind: "header";
  readonly id: string;
  readonly label: string;
}

interface GroupRow {
  readonly kind: "row";
  readonly id: string;
  readonly record: TranscriptRecord;
}

type ListEntry = GroupHeader | GroupRow;

const DAY_MS = 86_400_000;

const startOfDay = (epochMs: number): number => {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const dayLabel = (epochMs: number, todayStart: number): string => {
  const diff = Math.round((todayStart - startOfDay(epochMs)) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return formatDayHeading(epochMs);
};

const groupRecords = (records: readonly TranscriptRecord[], todayStart: number): ListEntry[] => {
  const out: ListEntry[] = [];
  let lastDay = -1;
  for (const record of records) {
    const day = startOfDay(record.createdAtMs);
    if (day !== lastDay) {
      out.push({
        kind: "header",
        id: `h-${String(day)}`,
        label: dayLabel(record.createdAtMs, todayStart)
      });
      lastDay = day;
    }
    out.push({ kind: "row", id: `r-${String(record.id)}`, record });
  }
  return out;
};

/**
 * A collapsed row measures ~93px: 24px of vertical padding, two clamped lines
 * at text-sm/leading-snug, a 6px gap, the metadata line, and the 8px gutter on
 * the positioning wrapper. Rows are still measured for real (expanding one
 * changes its height), but an accurate estimate is what stops the total size
 * from drifting under the scrollbar mid-drag.
 */
const ROW_HEIGHT = 93;
const HEADER_HEIGHT = 36;

export function HistoryView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [records, setRecords] = useState<readonly TranscriptRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [copyArmed, setCopyArmed] = useState<number | null>(null);
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  // Stable within a calendar day, so the grouping memo survives every scroll.
  const todayStart = startOfDay(Date.now());
  const entries = useMemo(() => groupRecords(records, todayStart), [records, todayStart]);

  // One effect owns the record set. The previous split (a load effect keyed on
  // [api] plus a search effect that returned early on an empty query) meant
  // clearing the search left the filtered list on screen.
  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim();
    const timer = window.setTimeout(
      () => {
        const request =
          trimmed.length === 0
            ? api.history.list({ limit: 500 })
            : api.history.search({ query: trimmed, limit: 200 });
        void request.then(({ items }) => {
          if (cancelled) return;
          setRecords(items);
          setLoading(false);
        });
      },
      trimmed.length === 0 ? 0 : 250
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, api]);

  useEffect(() => {
    if (deleteArmed === null) return;
    const timer = window.setTimeout(() => {
      setDeleteArmed(null);
    }, 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [deleteArmed]);

  useEffect(() => {
    if (copyArmed === null) return;
    const timer = window.setTimeout(() => {
      setCopyArmed(null);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copyArmed]);

  // Ctrl+F is what every desktop app binds to "find in this list". Escape
  // clears the query rather than only blurring, because a stale filter is the
  // reason a list looks empty.
  useEffect(() => {
    // The React KeyboardEvent is imported above for the list handler, so the
    // DOM one has to be named explicitly here.
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.getElementById(SEARCH_INPUT_ID)?.focus();
        return;
      }
      if (event.key === "Escape" && query.length > 0) {
        event.preventDefault();
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [query]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const getItemKey = useCallback(
    (index: number): string | number => entries[index]?.id ?? index,
    [entries]
  );
  const estimateSize = useCallback(
    (index: number): number => (entries[index]?.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
    [entries]
  );

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize,
    overscan: 6
  });

  // Find the first row index so key navigation lands on a row, not a header.
  const rowIndices = useMemo(() => {
    const out: number[] = [];
    entries.forEach((entry, index) => {
      if (entry.kind === "row") out.push(index);
    });
    return out;
  }, [entries]);
  const firstRowIndex = rowIndices[0] ?? 0;

  const focusedEntryIndex = Math.min(Math.max(focusedIndex, 0), entries.length - 1);
  const focusedEntry = entries[focusedEntryIndex];
  const focusedRowId = focusedEntry?.kind === "row" ? focusedEntry.record.id : null;

  const handleCopy = useCallback(
    (id: number, text: string): void => {
      api.clipboard.copy(text);
      setCopyArmed(id);
    },
    [api]
  );

  const handleArmDelete = useCallback((id: number): void => {
    setDeleteArmed(id);
  }, []);

  const handleCancelArmedDelete = useCallback((): void => {
    setDeleteArmed(null);
  }, []);

  const handleConfirmDelete = useCallback(
    (id: number): void => {
      void api.history.remove({ id }).then(() => {
        setRecords((current) => current.filter((item) => item.id !== id));
        setDeleteArmed(null);
      });
    },
    [api]
  );

  const handleToggleExpanded = useCallback((id: number): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (rowIndices.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = rowIndices.find((index) => index > focusedEntryIndex) ?? firstRowIndex;
      setFocusedIndex(next);
      rowVirtualizer.scrollToIndex(next, { align: "auto" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const previous = [...rowIndices].reverse().find((index) => index < focusedEntryIndex);
      setFocusedIndex(previous ?? firstRowIndex);
      rowVirtualizer.scrollToIndex(previous ?? firstRowIndex, { align: "auto" });
    } else if (event.key === "Enter" && focusedEntry?.kind === "row") {
      event.preventDefault();
      handleCopy(focusedEntry.record.id, focusedEntry.record.text);
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      focusedEntry?.kind === "row"
    ) {
      event.preventDefault();
      if (deleteArmed === focusedEntry.record.id) {
        handleConfirmDelete(focusedEntry.record.id);
      } else {
        handleArmDelete(focusedEntry.record.id);
      }
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex shrink-0 items-end justify-between gap-5 px-6 pb-4 pt-5">
        <div>
          <h1 className="font-display text-2xl font-normal tracking-tight text-text">History</h1>
          <p className="mt-1 text-sm text-text-muted">Find, copy, and review every transcript.</p>
        </div>
        <div className="pb-0.5">
          <SearchInput
            id={SEARCH_INPUT_ID}
            value={query}
            onChange={setQuery}
            onClear={() => {
              setQuery("");
            }}
            placeholder="Search transcripts"
            className="w-[280px]"
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4 focus:outline-none"
        onKeyDown={onListKeyDown}
        tabIndex={0}
        role="list"
        aria-label="Transcripts"
      >
        {loading && <p className="px-4 py-6 text-sm text-text-muted">Loading your transcripts...</p>}

        {!loading && records.length === 0 && (
          <EmptyState
            icon="ph:clock-counter-clockwise"
            title={
              query.trim().length > 0 ? "Nothing matches that search." : "No transcripts yet."
            }
            body={
              query.trim().length > 0
                ? "Try a different word, or clear the search to see everything."
                : "Hold your key, say a sentence, release. It will land here."
            }
          />
        )}

        {!loading && records.length > 0 && (
          <div style={{ height: `${String(rowVirtualizer.getTotalSize())}px`, position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = entries[virtualRow.index];
              if (entry === undefined) return null;
              if (entry.kind === "header") {
                return (
                  <div
                    key={entry.id}
                    style={{
                      position: "absolute",
                      top: "0",
                      left: "0",
                      width: "100%",
                      height: `${String(virtualRow.size)}px`,
                      transform: `translateY(${String(virtualRow.start)}px)`
                    }}
                    className="flex items-center px-1"
                  >
                    <span className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                      {entry.label}
                    </span>
                  </div>
                );
              }
              const record = entry.record;
              return (
                <div
                  key={entry.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: "0",
                    left: "0",
                    width: "100%",
                    transform: `translateY(${String(virtualRow.start)}px)`,
                    paddingBottom: "8px"
                  }}
                >
                  <TranscriptRow
                    record={record}
                    focused={record.id === focusedRowId}
                    expanded={expanded.has(record.id)}
                    copyArmed={copyArmed === record.id}
                    deleteArmed={deleteArmed === record.id}
                    onToggleExpanded={handleToggleExpanded}
                    onCopy={handleCopy}
                    onArmDelete={handleArmDelete}
                    onConfirmDelete={handleConfirmDelete}
                    onCancelArmedDelete={handleCancelArmedDelete}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

Changes to check off against the diagnosis table:

- #1 `entries` memoized on `[records, todayStart]`.
- #2 handled in `format.ts` (step 3.1).
- #3 all five handlers are `useCallback`, and `TranscriptRow`'s memo now bites.
- #4 the custom `measureElement` option is **gone**. TanStack falls back to its
  default, which prefers the ResizeObserver entry's `borderBoxSize` and does
  not force layout. `ref={rowVirtualizer.measureElement}` on the row wrapper
  stays: expanding a row must still remeasure.
- #5 `rowIndices` memoized.
- #6 `willChange: "transform"` removed from both branches.
- #7 `getItemKey` and `estimateSize` are `useCallback`.
- `overscan` 12 to 6, halving the mounted row count.
- `ROW_HEIGHT` 88 to 93.
- The search effect now owns both list and search.

## WS3 acceptance

Measure, do not eyeball. With `pnpm dev` and at least 300 transcripts in the
profile:

1. DevTools Performance, record a 5 second drag-scroll through History.
   Before: long tasks with `groupRecords` and `Intl` construction visible in
   the flame chart, dropped frames. After: no frame over 16ms in the steady
   state, and `HistoryView` render should be a thin sliver.
2. React DevTools Profiler with "Highlight updates" on: during a scroll, only
   rows entering or leaving the window should flash. Before, every visible row
   flashes on every frame.
3. Drag the scrollbar thumb from top to bottom in one motion. The thumb must
   not resize under the pointer.
4. Type in the search box, then clear it. The full list must come back.
5. Expand a long transcript, scroll away, scroll back. Height is preserved.
6. Arrow keys, Enter to copy, Delete twice to delete: all unchanged.

If you need a seeded profile, point `STRUQ_VOICE_USERDATA` at a scratch dir
and insert rows through `src/main/db/history-store.ts` from a throwaway
script; do not add fixtures to the repo.

---

# WS4: The Dictionary tab

## Why this exists

The dictionary is currently four fields buried inside
`Settings > Text > Words to fix` (`src/renderer/main/views/settings/TextTab.tsx`).
For a dictation product this is the main correction surface: it is how a user
teaches the app their company name, their colleagues' names, and their
jargon. It is used repeatedly, it grows to dozens of entries, and it needs
search, per-rule options and a way to check a rule before trusting it. That is
a page, not a settings row.

The schema already carries `matchCase` and `wholeWord`
(`src/shared/settings.ts:12-17`) and **the UI has never exposed either**.
Every entry created through the current form is hardcoded to
`{ matchCase: false, wholeWord: true }`.

## Scope decisions, already made. Do not relitigate these.

| Decision | Choice | Why |
|---|---|---|
| Where the data lives | Stays in `settings.post.dictionary` | Already persisted, validated by zod, already read at delivery time in `src/main/index.ts:373-380`. Moving it to SQLite buys nothing and breaks the settings round trip. |
| Entry identity | The `from` string, lowercased | Duplicates on `from` are already forbidden case-insensitively (`TextTab.tsx:41-42`). Adding an `id` field means a schema migration and a write-back on first parse for no user-visible gain. |
| New schema fields | `enabled: boolean` only | Backwards compatible via a zod default. Everything else the UI needs is derived. |
| Preview | Renderer-side, pure | Extract the matching primitives to `src/shared/dictionary.ts` so main and renderer run byte-identical regexes. No new IPC for preview. |
| Import / export | Two new IPC channels using `dialog` in main | Follows the existing `models:import` pattern (`src/main/ipc.ts:348-364`). A renderer-side `Blob` download in a sandboxed window is a different can of worms. |
| Route position | Between History and Models | Reads as "what came out" then "how it is corrected" then "what produces it". |
| Settings > Text | Keeps the cleanups, loses the dictionary block, gains a link | One home for a feature. |

## Phase A: shared matching primitives

### A.1 New file: `src/shared/dictionary.ts`

```ts
/**
 * Dictionary matching: the rules behind "heard as X, write Y".
 *
 * These primitives live in shared because two processes must agree exactly.
 * Main applies them to every transcript before delivery; the Dictionary view
 * applies them to the preview box the user types into. A preview built on a
 * second implementation is a preview that lies.
 *
 * No side effects, no Electron imports.
 */

export interface DictionaryRule {
  readonly from: string;
  readonly to: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly enabled: boolean;
}

/** Escape a string for use inside a RegExp. */
export const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One rule as a global RegExp.
 *
 * Note the fixed behaviour: the old buildAnyPattern used flag "g" even when
 * matchCase was false, so a non-whole-word rule silently matched case
 * sensitively. matchCase now means what it says in all four combinations.
 */
export const buildRulePattern = (rule: {
  readonly from: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
}): RegExp => {
  const body = escapeRegExp(rule.from);
  const bounded = rule.wholeWord ? `\\b${body}\\b` : body;
  return new RegExp(bounded, rule.matchCase ? "g" : "gi");
};

export interface RuleMatch {
  readonly start: number;
  readonly end: number;
}

/** Where a rule fires in this text, for highlighting the preview. */
export const findRuleMatches = (text: string, rule: DictionaryRule): readonly RuleMatch[] => {
  if (rule.from.length === 0) return [];
  const pattern = buildRulePattern(rule);
  const out: RuleMatch[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    out.push({ start: match.index, end: match.index + match[0].length });
    // A zero-length match would loop forever.
    if (match[0].length === 0) pattern.lastIndex += 1;
    match = pattern.exec(text);
  }
  return out;
};

/** Apply every enabled rule, in order. Disabled rules are skipped entirely. */
export const applyDictionary = (text: string, rules: readonly DictionaryRule[]): string => {
  let output = text;
  for (const rule of rules) {
    if (!rule.enabled || rule.from.length === 0) continue;
    output = output.replace(buildRulePattern(rule), rule.to);
  }
  return output;
};

/** How many times each rule fires, keyed by `from`. Drives the preview summary. */
export const countRuleHits = (
  text: string,
  rules: readonly DictionaryRule[]
): ReadonlyMap<string, number> => {
  const out = new Map<string, number>();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    out.set(rule.from, findRuleMatches(text, rule).length);
  }
  return out;
};
```

### A.2 New file: `src/shared/dictionary.test.ts`

Cover, at minimum:

- whole word on and off, case sensitive and insensitive, all four combinations
- regex special characters in `from` (mirror the existing case
  `"price (est.)"` from `src/main/post/text-cleanup.test.ts:103-112`)
- a disabled rule is a no-op
- `findRuleMatches` returns every occurrence, not just the first
- an empty `from` never matches and never throws
- a rule whose `to` contains `$&` or `$1` is inserted literally or documented
  as intentional. Decide and test it: `String.replace` treats `$&` in the
  replacement as a back-reference. Recommended: leave the current behaviour
  (users can exploit it) but **add a test that pins it**, so it is a decision
  rather than an accident.

### A.3 Rewire `src/main/post/text-cleanup.ts`

Delete `escapeRegExp`, `buildWholeWordPattern`, `buildAnyPattern`,
`buildCaseSensitivePattern` and the local `applyDictionary`. Import from
shared instead:

```ts
import type { DictionaryRule } from "../../shared/dictionary";
import { applyDictionary } from "../../shared/dictionary";

export type DictionaryEntry = DictionaryRule;
```

Keep the `DictionaryEntry` alias exported so nothing else in main breaks.
`CleanupOptions.dictionary` becomes `readonly DictionaryRule[]`.

`src/main/index.ts:376-380` passes `current.post.dictionary` straight through.
Once `enabled` is on the schema (Phase B) the settings entry structurally
satisfies `DictionaryRule`, so that call site needs no change.

Run `pnpm test`. `src/main/post/text-cleanup.test.ts` must still pass
unmodified. The one behaviour change (case-insensitive non-whole-word) makes
the existing `"tow ree"` case more permissive, not less, so it still passes.

## Phase B: schema

File: `src/shared/settings.ts`

```ts
export const dictionaryEntrySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  matchCase: z.boolean().default(false),
  wholeWord: z.boolean().default(true),
  /** Off keeps the rule in the list without applying it. */
  enabled: z.boolean().default(true)
});
```

That is the whole schema change. `version` stays `1`: a new field with a
default is a widening, and `migrateSettings` already fills defaults for any
persisted entry that predates it.

Note the pre-existing constraint `to: z.string().min(1)`. **A rule cannot
delete a word**, because an empty `to` fails validation. Either:

- (a) Leave it, and have the UI disable Add when `to` is empty with the hint
  "Leave the replacement empty is not supported yet", or
- (b) Relax it to `z.string()` and let a rule delete a phrase (genuinely useful
  for stripping a verbal tic that is not in the filler list).

**Choose (b).** It is one character, it is backwards compatible, and "always
remove the phrase 'you know'" is a real request. Add a test for it in
`src/shared/dictionary.test.ts`. Make sure the UI's Add button then keys off
`from` only, which is already how `TextTab.tsx:163` behaves.

## Phase C: the route

### C.1 `src/renderer/main/store/use-main-store.ts`

```ts
export type Route = "dictate" | "history" | "dictionary" | "models" | "settings";

export const ROUTE_ORDER: readonly Route[] = [
  "dictate",
  "history",
  "dictionary",
  "models",
  "settings"
];

export const ROUTE_LABELS: Record<Route, string> = {
  dictate: "Dictate",
  history: "History",
  dictionary: "Dictionary",
  models: "Models",
  settings: "Settings"
};
```

Consequences to handle, all of them:

- `src/renderer/main/main.tsx:51-58` maps Ctrl+1..N off `ROUTE_ORDER`, so the
  shortcuts shift automatically: Ctrl+3 becomes Dictionary, Ctrl+4 Models,
  Ctrl+5 Settings. Nothing to edit, but say so in the release notes.
- `src/renderer/main/components/Rail.tsx:9-14` needs
  `dictionary: "ph:book-open-text"` in `ROUTE_ICONS`. The rail already filters
  `settings` out of the top group and pins it to the bottom, so the new route
  slots in without further edits.
- `src/renderer/main/components/CommandPalette.tsx:15-20` needs the same key in
  its own `ROUTE_ICONS`, and its Ctrl+N hint (`line 136`) is derived from the
  index, so it stays correct.
- `src/renderer/main/App.tsx` needs
  `{route === "dictionary" && <DictionaryView />}` in the route switch
  (currently lines 121-124).

**Icon choice:** `ph:book-open-text`. Not `ph:translate` (this is not
translation), not `ph:magic-wand` (reads as AI slop), not `ph:swap` (already
used inside the empty state). Verify it exists in
`src/assets/icons/ph.json` before committing; the icon set is bundled, not
fetched, so a missing name renders nothing at all. There is an existing guard
test at `src/renderer/main/lib/icons.test.ts`; check whether it enumerates
used names and extend it if so.

### C.2 Tray

Check `src/main/tray.ts` for a route enumeration. If the tray menu opens the
window on a specific route, add Dictionary there too. If it does not enumerate
routes, no change. (`src/main/tray.ts` and `src/main/tray.test.ts` are both
already modified in the working tree, so coordinate before touching them.)

## Phase D: the view

### D.1 Layout

Three zones, top to bottom, inside `PageBody`
(`src/renderer/main/components/PageHeader.tsx:36`, which owns the
`max-w-[880px]` gutter, so do not invent your own):

```
+--------------------------------------------------------------+
| Dictionary                          [search]  [Import][Export]|
| Teach Struq Voice the words it keeps getting wrong.           |
+--------------------------------------------------------------+
| ADD A RULE                                                    |
| [ Heard as        ] -> [ Should be       ]  [Aa][ab|]  [ Add ]|
+--------------------------------------------------------------+
| TRY IT                                             12 of 40   |
| [ multi-line text area, 3 rows                              ] |
| [ result, with replacements highlighted in accent           ] |
+--------------------------------------------------------------+
| 40 RULES                              [Recent v] [Clear all]  |
| +----------------------------------------------------------+ |
| | (o) struck  ->  Struq            Aa  ab|      [edit][del] | |
| | (o) tow ree ->  Tauri                ab|      [edit][del] | |
| | ( ) postgress -> PostgreSQL      Aa           [edit][del] | |
| +----------------------------------------------------------+ |
+--------------------------------------------------------------+
```

- `(o)` is a `Switch` bound to `enabled`. A disabled row drops its text to
  `text-text-muted` and keeps everything else in place: the row must not
  change height or the list jumps.
- `Aa` and `ab|` are two `IconButton`-sized toggles for `matchCase` and
  `wholeWord`, shown as active pills when on. Use
  `ph:text-aa` for case and `ph:selection` for whole word, or plain 2-character
  labels in a `Badge` with `tone="accent"` when on and `tone="neutral"` when
  off. Tooltip them: "Match capitalisation" and "Whole words only".
- "12 of 40" in the Try It header is the live count of rules that fire on the
  sample text, from `countRuleHits`.
- The rule list is **not** virtualized. A dictionary is tens of entries, not
  thousands; adding a virtualizer here would be the WS3 problem invented from
  scratch. If it ever exceeds 200 entries, revisit.

### D.2 New file: `src/renderer/main/views/DictionaryView.tsx`

Structure to follow (the implementer writes the body; this is the contract):

```tsx
export function DictionaryView(): JSX.Element
```

State:

```tsx
  const api = window.struqVoice as MainWindowApi;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "alphabetical">("recent");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [confirmClear, setConfirmClear] = useState(false);
```

where

```tsx
interface Draft {
  readonly from: string;
  readonly to: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
}

const EMPTY_DRAFT: Draft = { from: "", to: "", matchCase: false, wholeWord: true };

const DEFAULT_SAMPLE =
  "Type a sentence here to see which rules fire before you rely on them.";
```

Settings plumbing, copied from `SettingsView.tsx:53-60` and `:90-94`:

```tsx
  useEffect(() => {
    void api.settings.get().then(({ settings: loaded }) => {
      setSettings(loaded);
    });
    return api.settings.onChange(setSettings);
  }, [api]);

  const writeDictionary = useCallback(
    (next: readonly DictionaryEntry[]): void => {
      void api.settings
        .update({ post: { ...settings.post, dictionary: [...next] } })
        .then(({ settings: updated }) => {
          setSettings(updated);
        });
    },
    [api, settings.post]
  );
```

Derived:

```tsx
  const dictionary = settings.post.dictionary;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered =
      needle.length === 0
        ? dictionary
        : dictionary.filter(
            (entry) =>
              entry.from.toLowerCase().includes(needle) ||
              entry.to.toLowerCase().includes(needle)
          );
    return sort === "alphabetical"
      ? [...filtered].sort((a, b) => a.from.localeCompare(b.from))
      : [...filtered].reverse();
  }, [dictionary, query, sort]);

  const preview = useMemo(() => applyDictionary(sample, dictionary), [sample, dictionary]);
  const hits = useMemo(() => countRuleHits(sample, dictionary), [sample, dictionary]);
  const firing = useMemo(
    () => [...hits.values()].filter((count) => count > 0).length,
    [hits]
  );
```

"Recent" is `[...filtered].reverse()` because entries are appended, so array
order already is chronological. Do not add a timestamp field for this.

Mutations, all going through `writeDictionary`:

- `addRule()`: trim `from`; reject empty; reject a case-insensitive duplicate
  of an existing `from` with the message `You already have a rule for "X".`
  (keep the exact wording from `TextTab.tsx:49`); append
  `{ ...draft, from, to, enabled: true }`; reset the draft; focus the "Heard
  as" field again so a user can type five rules without touching the mouse.
- `updateRule(originalFrom, patch)`: map over the array, replacing the entry
  whose `from` matches; re-run the duplicate check against every other entry.
- `toggleEnabled(from)`: map, flip `enabled`. No confirmation, no toast.
- `removeRule(from)`: filter it out. Follow the History pattern: first click
  arms, second click within 3000ms confirms, blur cancels. Do not open a
  dialog for a single row.
- `clearAll()`: this one **does** get a `Dialog`
  (`src/renderer/main/components/ui/Dialog.tsx`), title "Clear the
  dictionary?", body naming the count, a `danger` confirm button.

Keyboard:

- Enter in either draft field calls `addRule()`.
- Escape cancels an in-progress edit, or clears the search if nothing is being
  edited.
- Ctrl+F focuses the search field. Reuse the `SEARCH_INPUT_ID` pattern from
  `HistoryView.tsx:142-160` verbatim, with a different id.

Preview rendering: render `sample` with matches wrapped. Build the segments
from `findRuleMatches` across all enabled rules, merge overlapping ranges,
then map to spans. Matched text gets
`className="rounded-sm bg-accent-soft px-0.5 text-accent-text"`. Below it,
render `preview` as plain text in a bordered `bg-bg-sunken` block so the user
sees input and output side by side. Use a `<textarea>` for the sample, not a
`TextInput`: three rows, `rows={3}`, styled to match `TextInput`'s border and
focus treatment.

### D.3 Empty state

When `dictionary.length === 0`, replace the rule list with `EmptyState`:

```tsx
<EmptyState
  icon="ph:book-open-text"
  title="No rules yet"
  body="Add a word Struq Voice keeps getting wrong. Company names, people's names, and technical terms are the usual suspects."
/>
```

Plus a **starter suggestions** row underneath: three or four one-click chips
that prefill the draft rather than committing a rule, so nothing lands in the
user's dictionary without them pressing Add. Suggestions should be honest
examples, not fake data: `struck -> Struq`, `get hub -> GitHub`,
`post gress -> PostgreSQL`.

### D.4 Strip the dictionary out of Settings > Text

File: `src/renderer/main/views/settings/TextTab.tsx`

Delete everything from the `SettingsGroup title="Words to fix"` block
(line 133) to its close (line 254), plus the now-unused state
(`fromText`, `toText`, `editing`, `error`), the `isDuplicate`/`addEntry`/
`startEdit`/`saveEdit`/`cancelEdit`/`removeEntry` helpers, and the imports
that go with them (`Button`, `EmptyState`, `Field`, `InlineError`,
`TextInput`, `DictionaryEntry`, `Icon`, `useState`).

Add in its place, still inside the same component:

```tsx
      <SettingsGroup title="Dictionary">
        <SettingsRow
          label="Words to fix"
          hint={
            settings.post.dictionary.length === 0
              ? "Teach Struq Voice the words it keeps getting wrong."
              : `${String(settings.post.dictionary.length)} rules applied to every transcript.`
          }
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                useMainStore.getState().setRoute("dictionary");
              }}
            >
              Open Dictionary
            </Button>
          }
        />
      </SettingsGroup>
```

`TextTabProps` keeps its `api` prop even though the body no longer uses it, to
match the other tabs' signature; if lint objects to the unused parameter,
destructure only what is used, exactly as the current file already does
(`{ settings, update }` at line 33).

**This breaks an e2e spec.** `e2e/ui.spec.ts:87-99` walks every checkbox under
Settings > Text and Settings > Delivery. Text still has checkboxes
(`removeFillers`, `addTrailingPunctuation` are `Switch`, which renders a Radix
button, not `input[type=checkbox]`, so verify what that locator actually
matches before assuming). Do not edit e2e specs without asking Roy first.
Flag it in the hand-back instead.

## Phase E: import and export

### E.1 Channels, `src/shared/ipc.ts`

Add near the settings channels (after line 326):

```ts
export const dictionaryExportChannel = "dictionary:export" as const;
export const dictionaryImportChannel = "dictionary:import" as const;

/** The on-disk interchange format. Versioned so a future shape can be read. */
export interface DictionaryFile {
  readonly kind: "struq-voice-dictionary";
  readonly version: 1;
  readonly entries: readonly {
    readonly from: string;
    readonly to: string;
    readonly matchCase: boolean;
    readonly wholeWord: boolean;
    readonly enabled: boolean;
  }[];
}

export interface DictionaryExportResult {
  readonly ok: boolean;
  /** Absent when the user cancelled the save dialog. */
  readonly path?: string;
  readonly message?: string;
}

export interface DictionaryImportResult {
  readonly ok: boolean;
  /** How many rules were added, ignoring ones that duplicate an existing from. */
  readonly added: number;
  readonly skipped: number;
  readonly message?: string;
}
```

Add to `PRELOAD_CHANNELS` (after the `settings` block at line 444):

```ts
  dictionary: {
    export: dictionaryExportChannel,
    import: dictionaryImportChannel
  },
```

### E.2 Preload, `src/preload/main.ts`

Mirror the `models.import` shape at lines 126-130:

```ts
  dictionary: {
    export: () =>
      ipcRenderer.invoke(channels.dictionary.export) as Promise<DictionaryExportResult>,
    import: () =>
      ipcRenderer.invoke(channels.dictionary.import) as Promise<DictionaryImportResult>
  },
```

### E.3 API type, `src/shared/api.ts`

Add to `MainWindowApi` after the `settings` block (line 70):

```ts
  readonly dictionary: {
    export: () => Promise<{ ok: boolean; path?: string; message?: string }>;
    import: () => Promise<{ ok: boolean; added: number; skipped: number; message?: string }>;
  };
```

### E.4 Handlers, `src/main/ipc.ts`

Register beside the settings handlers. Pattern to follow, including the
cancel-is-not-an-error convention already used by `models:import`
(lines 348-364):

```ts
  ipcMain.handle(dictionaryExportChannel, async (): Promise<DictionaryExportResult> => {
    if (settingsStore === null) return { ok: false, message: "Settings unavailable." };
    const picked = await dialog.showSaveDialog({
      title: "Export dictionary",
      defaultPath: "struq-voice-dictionary.json",
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (picked.canceled || picked.filePath === undefined) {
      return { ok: false, message: "Export cancelled." };
    }
    const file: DictionaryFile = {
      kind: "struq-voice-dictionary",
      version: 1,
      entries: settingsStore.get().post.dictionary
    };
    await writeFile(picked.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    return { ok: true, path: picked.filePath };
  });
```

Import: `showOpenDialog` with `properties: ["openFile"]` and the same JSON
filter, `readFile`, `JSON.parse` inside a `try`, then validate with a zod
schema. **Do not trust the file.** Add to `src/shared/settings.ts`:

```ts
export const dictionaryFileSchema = z.object({
  kind: z.literal("struq-voice-dictionary"),
  version: z.literal(1),
  entries: z.array(dictionaryEntrySchema)
});
```

Merge policy: append entries whose `from` does not already exist
case-insensitively; count the rest as `skipped`. Never overwrite an existing
rule silently. Write through `settingsStore.update(...)` so the
`settings:changed` broadcast fires and every open window updates itself
(`src/main/ipc.ts` already broadcasts on `settingsUpdateChannel`; match how
that handler does it).

Both handlers must catch and return `{ ok: false, message }` rather than
throwing across IPC. Never log the file contents.

### E.5 UI wiring

Two `Button variant="secondary" size="sm"` in the page header actions slot.
After an import, show the outcome inline for a few seconds:
`Added 12 rules, skipped 3 duplicates.` Use the same self-clearing timeout
pattern as `copyArmed` in History. Do not use a toast system; there isn't one.

## Phase F: tests

Unit (`pnpm test`, these are required):

- `src/shared/dictionary.test.ts` as specified in A.2.
- `src/main/post/text-cleanup.test.ts` must pass **unchanged** after the
  rewire. If it does not, the extraction changed behaviour and you need to
  find out why before proceeding.
- Add a case to the settings tests (find them under `src/main/store/`) proving
  a persisted entry without `enabled` parses to `enabled: true`, and that
  `dictionaryFileSchema` rejects a file with the wrong `kind`.

Renderer: there is no component test harness in this repo. Do not add one for
this. Verify the view by hand against the acceptance list.

## WS4 acceptance

- Rail shows five items; Ctrl+3 opens Dictionary; the active pill glides
  correctly to and from the new row.
- Adding a rule from Dictionary changes the transcript on the next dictation.
  Test end to end with `STRUQ_VOICE_ENGINE=mock`: the mock returns a fixed
  transcript, so a rule targeting a word in it must visibly rewrite it.
- All four `matchCase`/`wholeWord` combinations behave as labelled, verified
  through the Try It box.
- Toggling a rule off stops it applying without removing it, and the row does
  not change height.
- Search filters on both `from` and `to`.
- Export writes valid JSON; re-importing it adds 0 and skips all.
- Importing a hand-edited file with a bad `kind` shows an error and changes
  nothing.
- Settings > Text no longer contains the dictionary and its link navigates.
- The whole view respects the theme in both light and dark, and every
  interactive element has a visible `:focus-visible` ring.

---

# Final gate checklist

```bash
pnpm typecheck    # tsc -p tsconfig.{node,web,e2e}.json
pnpm lint         # eslint . (strictTypeChecked)
pnpm test         # vitest
```

Do **not** run `pnpm test:e2e` unprompted; `hook.spec.ts` needs a real
microphone and real OS focus. If you want boot confidence:

```bash
pnpm exec electron-vite build
STRUQ_VOICE_E2E=1 STRUQ_VOICE_ENGINE=mock \
  STRUQ_VOICE_USERDATA=$(mktemp -d) \
  timeout 12 npx electron --headless out/main/index.cjs
```

then always:

```bash
taskkill //F //IM electron.exe
taskkill //F //IM "Struq Voice.exe"
```

Before finishing, grep your own diff:

```bash
git diff | grep -nP '[\x{2013}\x{2014}\x{2015}]'
```

An empty result is the only acceptable one.

## Suggested commits

One concern each, conventional commits:

1. `feat: lift the splash as a two-sheet curtain and rise the shell behind it`
2. `perf: stop measuring the History list on every scroll frame`
3. `fix: restore the full transcript list when the History search is cleared`
4. `feat: draw the activity chart in with a weighted sweep`
5. `refactor: move dictionary matching into shared`
6. `feat: give the dictionary its own view`
7. `feat: import and export the dictionary as JSON`
8. `docs: record the dictionary view in FEATURES`

Update `docs/FEATURES.md` in the last one. It is the built / current /
known-gaps picture and it will be wrong the moment WS4 lands.
