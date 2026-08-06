import type { JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";

/**
 * The one page header. Every view wears it, so moving between Dictate,
 * History, Models and Settings never changes the shape of the window.
 *
 * There is no description slot on purpose. Each view previously opened with
 * a sentence explaining what the view was ("Everything you have dictated,
 * with the words you used..."), which is a caption for a title the user just
 * clicked to get here. The title and the content say it.
 */
export interface PageHeaderProps {
  readonly icon: string;
  readonly title: string;
  /** Right-aligned page controls: a search field, a filter, an action. */
  readonly actions?: ReactNode;
}

export function PageHeader({ icon, title, actions }: PageHeaderProps): JSX.Element {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-bg px-6">
      <Icon icon={icon} className="h-[18px] w-[18px] shrink-0 text-text-muted" aria-hidden="true" />
      <h1 className="font-display text-md font-semibold tracking-tight text-text">{title}</h1>
      {actions !== undefined && (
        <div className="ml-auto flex min-w-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/**
 * The scroll body under a PageHeader. Owns the page gutter so no view
 * invents its own, which is how px-8/py-8/py-5 all ended up in the tree.
 */
export function PageBody({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-selectable>
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-6 py-5">{children}</div>
    </div>
  );
}

