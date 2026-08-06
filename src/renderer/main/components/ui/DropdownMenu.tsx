import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import type { JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";
import type { IconifyIcon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * An item in a DropdownMenu. The whole API mirrors what the palette and the
 * status cluster build today: label, icon, danger treatment, disabled.
 */
export interface DropdownMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string | IconifyIcon;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface DropdownMenuProps {
  readonly trigger: ReactNode;
  readonly items: readonly DropdownMenuItem[];
  readonly align?: "start" | "center" | "end";
  readonly side?: "top" | "bottom" | "left" | "right";
}

const ITEM_CLASS =
  "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-text outline-none data-[highlighted]:bg-surface-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";

const DANGER_ITEM_CLASS =
  "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";

export function DropdownMenu({
  trigger,
  items,
  align = "start",
  side = "bottom"
}: DropdownMenuProps): JSX.Element {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          side={side}
          align={align}
          sideOffset={6}
          className="z-50 min-w-[12rem] rounded-md border border-border bg-surface p-1 text-text shadow-lift"
        >
          {items.map((item) => (
            <RadixDropdown.Item
              key={item.id}
              disabled={item.disabled === true}
              onSelect={(event) => {
                event.preventDefault();
                item.onSelect();
              }}
              className={cn(item.danger === true ? DANGER_ITEM_CLASS : ITEM_CLASS)}
            >
              {item.icon !== undefined && (
                <Icon icon={item.icon} className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {item.label}
            </RadixDropdown.Item>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}
