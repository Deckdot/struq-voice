import type { JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";

/**
 * The frame every onboarding step renders into: the progress row, a
 * headline, a supporting line, the step's own controls, then the actions.
 * The first step arrives already satisfied, so the user starts partway
 * rather than at zero.
 */
export interface StepShellProps {
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly completed: readonly boolean[];
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly actions: ReactNode;
}

export function StepShell({
  stepIndex,
  stepCount,
  completed,
  title,
  description,
  children,
  actions
}: StepShellProps): JSX.Element {
  const done = completed.filter(Boolean).length;

  return (
    <div className="mx-auto flex h-full w-full max-w-[640px] flex-col justify-center gap-6 px-8 py-8">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5" aria-hidden="true">
          {completed.map((isDone, index) => (
            <span
              key={index}
              className={`h-1 rounded-full transition-all duration-normal ${
                index === stepIndex ? "w-6" : "w-3"
              } ${
                isDone
                  ? "bg-accent"
                  : index === stepIndex
                    ? "bg-border-strong"
                    : "bg-border"
              }`}
            />
          ))}
        </span>
        <span className="font-sans text-2xs uppercase tracking-wide text-text-muted" data-numeric>
          {String(done)} of {String(stepCount)} done
        </span>
      </div>

      <div>
        <h1 className="font-display text-2xl font-medium tracking-tight text-text">{title}</h1>
        <p className="mt-1.5 text-sm leading-snug text-text-muted">{description}</p>
      </div>

      <div className="flex flex-col gap-3">{children}</div>

      <div className="flex items-center justify-between gap-3">{actions}</div>
    </div>
  );
}

/**
 * A row inside a step showing something the app already worked out, with
 * the option to change it. The check tells the user this part is handled.
 */
export interface ReadyRowProps {
  readonly label: string;
  readonly value: string;
  readonly ready: boolean;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}

export function ReadyRow({ label, value, ready, action, children }: ReadyRowProps): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-text">
            {ready && <Icon icon="ph:check-circle" className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
            {label}
          </p>
          <p className="mt-0.5 text-sm text-text-muted">{value}</p>
        </div>
        {action}
      </div>
      {children !== undefined && <div className="mt-3">{children}</div>}
    </div>
  );
}
