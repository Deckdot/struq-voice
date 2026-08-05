import type { JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Small caps on a soft fill: engine names, install state, cloud and local
 * markers. Each tone pairs a soft background with its matching solid text,
 * so the badge reads as tinted rather than filled.
 */
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-bg-sunken text-text-secondary",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger"
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Badge({ tone = "neutral", className, children }: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs uppercase tracking-wide",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
