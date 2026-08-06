import type { JSX, ReactElement, ReactNode } from "react";
import { Icon } from "@iconify/react";
import type { IconifyIcon } from "@iconify/react";
import { Tooltip } from "./Tooltip";
import { cn } from "../../lib/cn";

/**
 * A compact icon-only control. The label drives both the aria-label and the
 * tooltip, so a screen reader user and a mouse user get the same words. The
 * tooltip wraps the child via Tooltip's asChild contract; a button that is
 * a focus target needs no separate Tooltip trigger.
 */
export type IconButtonVariant = "ghost" | "secondary" | "danger";
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps {
  readonly icon: string | IconifyIcon;
  readonly label: string;
  readonly size?: IconButtonSize;
  readonly variant?: IconButtonVariant;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly className?: string;
  readonly children?: ReactNode;
}

export function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  active = false,
  disabled = false,
  onClick,
  className,
  children
}: IconButtonProps): JSX.Element {
  const square = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const base = cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md",
    "transition-colors duration-hover",
    "disabled:cursor-not-allowed disabled:opacity-45",
    square,
    variant === "secondary" && "bg-surface text-text-secondary border border-border hover:bg-surface-hover hover:text-text active:bg-surface-active",
    variant === "ghost" && "text-text-secondary hover:bg-surface-hover hover:text-text active:bg-surface-active",
    variant === "danger" && "text-danger hover:bg-danger-soft",
    active && "text-accent bg-accent-soft",
    className
  );

  const button = (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={base}
    >
      <Icon icon={icon} className="h-4 w-4" aria-hidden="true" />
      {children}
    </button>
  );

  return (
    <Tooltip label={label} side="bottom">
      <span className="inline-flex">{button as ReactElement}</span>
    </Tooltip>
  );
}
