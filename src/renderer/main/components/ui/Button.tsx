import type { ButtonHTMLAttributes, JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * The four button variants. Every state moves lightness only: hover and
 * active shift the background, never the hue, so a primary button never
 * reads as anything other than the brand accent.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-solid text-text-inverse hover:bg-accent-solid-hover active:bg-accent-solid-active motion-safe:active:scale-[0.97]",
  secondary:
    "bg-surface text-text border border-border hover:bg-surface-hover active:bg-surface-active motion-safe:active:scale-[0.97]",
  ghost:
    "text-text-secondary hover:bg-surface-hover hover:text-text active:bg-surface-active motion-safe:active:scale-[0.97]",
  danger:
    "bg-surface text-danger border border-danger hover:bg-danger-soft motion-safe:active:scale-[0.97]"
};

/** 28 / 32 / 40. The large size is reserved for the single primary call in a step. */
const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-8 gap-2 px-3 text-sm",
  lg: "h-10 gap-2 px-4 text-sm"
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md font-medium",
        "transition-colors duration-hover",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-bg-sunken disabled:text-text-muted",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
