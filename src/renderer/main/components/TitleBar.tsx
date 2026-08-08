import type { CSSProperties, JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import { BrandMark } from "./Brand";
import { Tooltip } from "./ui";
import { useTranslation } from "../lib/useTranslation";

const CONTROL_BASE =
  "flex h-9 w-[46px] items-center justify-center text-text-secondary transition-colors duration-hover hover:bg-border/70 hover:text-text active:bg-border-strong/80";

export interface TitleBarProps {
  readonly onSearch: () => void;
}

export function TitleBar({ onSearch }: TitleBarProps): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const { t } = useTranslation();
  const searchLabel = `${t("search.open")} (Ctrl+F)`;

  return (
    <header
      className="relative flex h-9 shrink-0 items-center justify-between border-b border-border bg-bg"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      <BrandMark size={20} className="pointer-events-none ml-3 text-text dark:text-ember" />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="font-display text-xs font-normal tracking-wide text-text-muted">
          Struq Voice
        </span>
      </div>

      <div
        className="relative flex items-center"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      >
        <Tooltip label={searchLabel} side="bottom">
          <button
            type="button"
            aria-label={searchLabel}
            onClick={onSearch}
            className="flex h-9 w-10 items-center justify-center border-s border-border/70 text-text-muted transition-colors duration-hover hover:bg-surface-hover hover:text-text active:bg-surface-active"
          >
            <Icon icon="ph:magnifying-glass" className="h-4 w-4" aria-hidden="true" />
          </button>
        </Tooltip>
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => {
            api.window.minimize();
          }}
          className={CONTROL_BASE}
        >
          <Icon icon="ph:minus" className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Maximize"
          onClick={() => {
            api.window.toggleMaximize();
          }}
          className={CONTROL_BASE}
        >
          <Icon icon="ph:square" className="h-3 w-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            api.window.close();
          }}
          className="flex h-9 w-[46px] items-center justify-center text-text-secondary transition-colors duration-hover hover:bg-[#c42b1c] hover:text-white active:bg-[#b0271a] active:text-white"
        >
          <Icon icon="ph:x" className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
