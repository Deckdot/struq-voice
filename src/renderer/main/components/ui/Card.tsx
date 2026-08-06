import type { JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A simple rounded surface for grouping content. The settings groups use
 * their own SettingsGroup; this Card is for the inline readiness card in
 * Dictate and any other one-off surfaces.
 */
export interface CardProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function Card({ children, className }: CardProps): JSX.Element {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface p-4", className)}
    >
      {children}
    </div>
  );
}
