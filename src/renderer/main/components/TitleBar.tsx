import type { CSSProperties, JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import { BrandMark } from "./Brand";

const CONTROL_BASE =
  "flex h-9 w-[46px] items-center justify-center text-text-secondary transition-colors duration-hover hover:bg-border/70 hover:text-text active:bg-border-strong/80";

export function TitleBar(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;

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
