import type { JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A titled group inside a view. The description sits with the title rather
 * than beside the controls, so a reader learns what the group is for before
 * meeting its first switch.
 */
export interface SectionProps {
  readonly title: string;
  readonly description?: string;
  /** Right-aligned control on the title row: a link or a single button. */
  readonly action?: ReactNode;
  readonly id?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Section({
  title,
  description,
  action,
  id,
  className,
  children
}: SectionProps): JSX.Element {
  return (
    <section id={id} className={cn("scroll-mt-6", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text">{title}</h2>
          {description !== undefined && (
            <p className="mt-0.5 text-sm leading-snug text-text-muted">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}
