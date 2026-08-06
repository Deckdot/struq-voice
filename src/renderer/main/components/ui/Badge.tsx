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
  /** Hover tooltip; used to surface the raw failure detail on error badges. */
  readonly title?: string;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-bg-sunken text-text-secondary border border-border",
  accent: "border border-accent bg-surface text-accent-text",
  success: "border border-border bg-surface text-success",
  warning: "border border-border bg-surface text-warning",
  danger: "border border-border bg-surface text-danger",
  ember: "border border-ember bg-surface text-ember",
  info: "border border-border bg-surface text-info"
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
  title
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2",
        "text-xs font-medium",
        TONE_CLASS[tone],
        className
      )}
      title={title}
    >
      {icon !== undefined && (
        <Icon icon={icon} className="h-3 w-3 shrink-0" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
