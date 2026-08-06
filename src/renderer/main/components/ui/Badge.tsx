import type { JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";
import type { IconifyIcon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * A small uppercase label that pairs a tone with an optional glyph. Use
 * `tone="ember"` only for live capture feedback; it carries meaning.
 */
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "ember" | "info";

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly icon?: string | IconifyIcon;
  readonly children: ReactNode;
  readonly className?: string;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-bg-sunken text-text-secondary border border-border",
  accent: "bg-accent-soft text-accent-text",
  success: "border border-border bg-surface text-success",
  warning: "border border-border bg-surface text-warning",
  danger: "border border-border bg-surface text-danger",
  ember: "bg-ember-soft text-ember",
  info: "border border-border bg-surface text-info"
};

export function Badge({ tone = "neutral", icon, children, className }: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2",
        "text-xs font-medium",
        TONE_CLASS[tone],
        className
      )}
    >
      {icon !== undefined && (
        <Icon icon={icon} className="h-3 w-3 shrink-0" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
