import type { HTMLAttributes, JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A raised surface: lighter than the page, hairline border, no shadow.
 * Depth here is a surface step, never a shadow stack. The two shadows this
 * system owns belong to the capture overlay and the command palette.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Recedes instead of raising: for wells and read-only detail. */
  readonly sunken?: boolean;
  readonly children?: ReactNode;
}

export function Card({ sunken = false, className, children, ...rest }: CardProps): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-lg border border-border p-4",
        sunken ? "bg-bg-sunken" : "bg-surface",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
