import type { JSX } from "react";
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
  const chartData: ChartItem[] = days.map((d) => {
    const dateObj = new Date(d.dayStartMs);
    const dateStr = dateObj.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    const fullDateStr = dateObj.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
    const durationSec = Math.round(d.durationMs / 1000);
    const durationMin = Number((durationSec / 60).toFixed(1));
    return {
      dateStr,
      fullDateStr,
      words: d.words,
      durationSec,
      durationMin
    };
  });

  return (
    <div className={`w-full h-44 ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="wordsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--sv-accent)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--sv-accent)" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="durationGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--sv-info)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--sv-info)" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--sv-border)" opacity={0.4} vertical={false} />
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
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--sv-border-strong)", strokeWidth: 1 }} />
          <Area
            yAxisId="words"
            type="monotone"
            dataKey="words"
            name="Words Spoken"
            stroke="var(--sv-accent)"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#wordsGradient)"
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
            fill="url(#durationGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
