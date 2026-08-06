import type { JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * Explanatory text inside a SettingsGroup.
 *
 * A SettingsGroup is already a bordered card, so wrapping prose in a Card
 * puts a card inside a card: two borders, two radii, doubled padding, and a
 * block that reads as a callout when it is only a sentence. This is a plain
 * row on the group's own surface, aligned to the same 16px gutter as every
 * SettingsRow above it.
 */
export interface SettingsNoteProps {
  readonly icon?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function SettingsNote({ icon, children, className }: SettingsNoteProps): JSX.Element {
  return (
    <div className={cn("flex items-start gap-2.5 px-4 py-3", className)}>
      {icon !== undefined && (
        <Icon
          icon={icon}
          className="mt-px h-4 w-4 shrink-0 text-text-muted"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 text-xs leading-snug text-text-secondary">{children}</div>
    </div>
  );
}
