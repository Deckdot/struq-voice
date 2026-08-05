import type { ButtonHTMLAttributes, JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * The four button variants from the design system, and no fifth. Every state
 * moves lightness only: hover drops L by 0.04, active by another 0.04, and
 * hue and chroma are frozen. Disabled drops opacity and never changes hue.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-solid text-text-inverse hover:bg-accent-solid-hover active:bg-accent-solid-active",
  secondary:
    "border border-border bg-surface text-text hover:bg-surface-hover active:bg-surface-active",
  ghost: "text-text-secondary hover:bg-surface-hover hover:text-text active:bg-surface-active",
  danger: "border border-danger text-danger hover:bg-danger-soft"
};

/** 28 / 32 / 40px. The large size is for the one primary action in a step. */
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
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md font-medium transition-colors duration-fast",
        "disabled:cursor-not-allowed disabled:opacity-45",
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
