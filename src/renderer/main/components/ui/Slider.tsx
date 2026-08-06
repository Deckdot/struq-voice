import { useMemo } from "react";
import type { JSX } from "react";
import { cn } from "../../lib/cn";

/**
 * A horizontal track with a weighted thumb. The filled portion is drawn with
 * a linear gradient set inline so the value changes the colour without a
 * repaint of the layout.
 */
export interface SliderProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (next: number) => void;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly unit?: string;
  readonly id?: string;
  readonly className?: string;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  label,
  unit,
  id,
  className
}: SliderProps): JSX.Element {
  const pct = useMemo(() => {
    const span = max - min;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (value - min) / span));
  }, [value, min, max]);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <input
        type="range"
        id={id}
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
        style={{
          background: `linear-gradient(to right, var(--sv-accent-solid) 0% ${String(pct * 100)}%, var(--sv-border) ${String(pct * 100)}% 100%)`
        }}
        className={cn(
          "h-1 w-full cursor-pointer appearance-none rounded-pill outline-none",
          "disabled:cursor-not-allowed disabled:opacity-45",
          "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent-solid [&::-webkit-slider-thumb]:bg-bg [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-press motion-safe:[&::-webkit-slider-thumb]:hover:scale-110",
          "[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-pill [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent-solid [&::-moz-range-thumb]:bg-bg"
        )}
      />
      {unit !== undefined && (
        <span className="w-10 text-right text-xs text-text-muted tabular-nums" data-numeric>
          {String(value)} {unit}
        </span>
      )}
    </div>
  );
}
