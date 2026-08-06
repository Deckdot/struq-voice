import type { JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A section heading plus an optional one-line description above a child
 * content slot. Used by the onboarding flow and a few one-off pages.
 */
export interface SectionProps {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function Section({ title, description, children, className }: SectionProps): JSX.Element {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <header>
        <h2 className="font-display text-lg font-medium text-text">{title}</h2>
        {description !== undefined && (
          <p className="mt-0.5 text-sm text-text-muted">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}
