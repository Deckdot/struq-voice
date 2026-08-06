import type { JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A single labelled row inside a SettingsGroup. The label and hint sit on the
 * left, the control on the right. Footer content (disclosures) renders full
 * width below the row, separated by a hairline.
 *
 * The control is centred against the whole label block, not top-aligned to
 * its first line. With items-start a 28px switch beside a two-line hint hangs
 * near the top of the row and every control in the panel reads as sitting too
 * high.
 */
export interface SettingsRowProps {
  readonly label: string;
  readonly hint?: string;
  readonly htmlFor?: string;
  readonly control: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
}

export function SettingsRow({
  label,
  hint,
  htmlFor,
  control,
  footer,
  className
}: SettingsRowProps): JSX.Element {
  return (
    <div className={cn("px-4 py-3", className)}>
      <div className="flex min-h-8 items-center justify-between gap-4">
        <div className="min-w-0">
          <label
            htmlFor={htmlFor}
            className="text-sm font-medium text-text"
          >
            {label}
          </label>
          {hint !== undefined && (
            <p className="mt-0.5 text-xs leading-snug text-text-muted">{hint}</p>
          )}
        </div>
        <div className="shrink-0">{control}</div>
      </div>
      {footer !== undefined && (
        <div className="mt-3 border-t border-border pt-3">{footer}</div>
      )}
    </div>
  );
}
