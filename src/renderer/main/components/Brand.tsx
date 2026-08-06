import type { JSX } from "react";
import { motion } from "motion/react";
import { cn } from "../lib/cn";

interface BarSpec {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The Struq symbol, parametric: four bars that grow rightward plus one ember
 * dot, mirroring struq-symbol.svg in a 64 unit box. Colours come from
 * currentColor (bars) and the ember token (dot), so the mark inherits its
 * context wherever it sits.
 */
const BARS: readonly BarSpec[] = [
  { x: 15, y: 25, width: 5, height: 14 },
  { x: 23, y: 21, width: 5, height: 22 },
  { x: 31, y: 16, width: 5, height: 32 },
  { x: 39, y: 9, width: 6, height: 46 }
];

const DOT = { cx: 9, cy: 32, r: 2 } as const;

export interface BrandMarkProps {
  readonly size?: number;
  readonly className?: string;
}

export function BrandMark({ size = 20, className }: BrandMarkProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Struq Voice"
      className={cn("block shrink-0", className)}
    >
      {BARS.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={2}
          fill="currentColor"
        />
      ))}
      <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill="var(--sv-ember)" />
    </svg>
  );
}

/** The splash variant: bars stagger up and the dot pops in behind them. */
export function BrandMarkAnimated({ size = 64, className }: BrandMarkProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("block shrink-0", className)}
      aria-hidden="true"
    >
      {BARS.map((bar, index) => (
        <motion.rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={2}
          fill="currentColor"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1], delay: index * 0.08 }}
        />
      ))}
      <motion.circle
        cx={DOT.cx}
        cy={DOT.cy}
        r={DOT.r}
        fill="var(--sv-ember)"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
      />
    </svg>
  );
}

export function BrandLockup({ size = 20, className }: BrandMarkProps): JSX.Element {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark size={size} className="text-text dark:text-ember" />
      <span className="font-display text-sm font-semibold tracking-tight text-text">
        Struq Voice
      </span>
    </div>
  );
}
