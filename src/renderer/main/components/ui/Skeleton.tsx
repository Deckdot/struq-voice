import type { JSX } from "react";
import { cn } from "../../lib/cn";

/**
 * A muted block used as a loading placeholder. The pulse is `motion-safe`
 * so a reduced-motion user sees a steady, slightly-lighter block.
 */
export interface SkeletonProps {
  readonly className?: string;
}

export function Skeleton({ className }: SkeletonProps): JSX.Element {
  return (
    <span
      className={cn(
        "block rounded-sm bg-bg-sunken motion-safe:animate-pulse",
        className
      )}
      aria-hidden="true"
    />
  );
}
