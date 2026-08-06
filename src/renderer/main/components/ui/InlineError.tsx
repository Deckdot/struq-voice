import type { JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * A short, inline error message. The warning glyph is always there so the
 * message is not communicated by colour alone.
 */
export interface InlineErrorProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function InlineError({ children, className }: InlineErrorProps): JSX.Element {
  return (
    <p
      role="alert"
      className={cn("inline-flex items-center gap-1.5 text-xs text-danger", className)}
    >
      <Icon icon="ph:warning-circle" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}
