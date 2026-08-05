import type { JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Label, control, help and error in one block. Help text stays attached to
 * the control it describes: an explanation that drifts away from its input
 * forces the reader to hold both halves in mind at once.
 */
export interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  /** Places the control beside the label instead of beneath it. */
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
        <p className="mt-0.5 text-sm leading-snug text-text-muted">{hint}</p>
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
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
