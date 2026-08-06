import type { JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * Label, hint, optional error and the actual control, in one block. The hint
 * sits next to the label it describes, not below the page.
 */
export interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly inline?: boolean;
  readonly htmlFor?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  inline = false,
  htmlFor,
  className,
  children
}: FieldProps): JSX.Element {
  const text = (
    <div className={inline ? "min-w-0" : undefined}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-text">
        {label}
      </label>
      {hint !== undefined && (
        <p className="mt-0.5 text-xs leading-snug text-text-muted">{hint}</p>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        inline ? "flex items-start justify-between gap-4" : "flex flex-col gap-2",
        className
      )}
    >
      {text}
      <div className={inline ? "shrink-0" : undefined}>{children}</div>
      {error !== undefined && (
        <p
          role="alert"
          className="mt-1 inline-flex items-center gap-1.5 text-xs text-danger"
        >
          <Icon icon="ph:warning-circle" className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
