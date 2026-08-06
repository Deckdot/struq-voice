import type { JSX, ReactNode } from "react";
import { SettingsRow } from "./SettingsRow";
import { cn } from "../../lib/cn";

/**
 * One logical block of related settings. The surface uses a single rounded
 * card with hairlines between rows, rather than a card per row, because
 * grouping is the point and a card per row buries it.
 */
export interface SettingsGroupProps {
  readonly title?: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function SettingsGroup({
  title,
  description,
  children,
  className
}: SettingsGroupProps): JSX.Element {
  return (
    <section className={cn("flex flex-col", className)}>
      {(title !== undefined || description !== undefined) && (
        <header className="mb-2 px-1">
          {title !== undefined && (
            <h2 className="font-display text-lg font-semibold text-text">{title}</h2>
          )}
          {description !== undefined && (
            <p className="mt-0.5 text-sm text-text-muted">{description}</p>
          )}
        </header>
      )}
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

export { SettingsRow };
