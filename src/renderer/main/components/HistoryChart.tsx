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
