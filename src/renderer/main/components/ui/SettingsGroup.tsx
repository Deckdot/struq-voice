import type { JSX, ReactNode } from "react";
import { SettingsRow } from "./SettingsRow";
import { cn } from "../../lib/cn";

/**
 * One logical block of related rows. The surface is a single rounded card
 * with hairlines between rows, rather than a card per row, because grouping
 * is the point and a card per row buries it.
 *
 * The title is a small uppercase label outside the card, not a display
 * heading. A 17px bold heading over every four-row group turns a settings
 * page into a landing page: the groups compete with the page title and the
 * eye has nowhere to rest. The label names the group and gets out of the way.
 */
export interface SettingsGroupProps {
  readonly title?: string;
  readonly description?: string;
  /** Right-aligned controls on the label line, for example "View all". */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function SettingsGroup({
  title,
  description,
  actions,
  children,
  className
}: SettingsGroupProps): JSX.Element {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;
  return (
    <section className={cn("flex flex-col", className)}>
      {hasHeader && (
        <header className="mb-2 flex min-h-5 items-center gap-2 px-0.5">
          {title !== undefined && (
            <h2 className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
              {title}
            </h2>
          )}
          {description !== undefined && (
            <p className="min-w-0 truncate text-xs text-text-muted">{description}</p>
          )}
          {actions !== undefined && <div className="ml-auto flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

export { SettingsRow };
