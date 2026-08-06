import type { JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";
import type { IconifyIcon } from "@iconify/react";

/**
 * A centered, image-free empty state. One icon, one headline, one short
 * paragraph and an optional action. Use this everywhere a list might be
 * empty (no transcripts, no search results, no history).
 */
export interface EmptyStateProps {
  readonly icon: string | IconifyIcon;
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Icon icon={icon} className="h-6 w-6 text-text-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-text">{title}</p>
      {body !== undefined && (
        <p className="max-w-[360px] text-sm text-text-muted">{body}</p>
      )}
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}
