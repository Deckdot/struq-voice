import type { CSSProperties, JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import { BrandLockup } from "./Brand";

const CONTROL_BASE =
  "flex h-8 w-[46px] items-center justify-center rounded-md text-text-muted transition-colors duration-hover hover:bg-surface-hover hover:text-text active:bg-surface-active";

/**
 * The custom title bar of the frameless main window. Draggable via the
 * native -webkit-app-region, which requires the buttons to opt out.
 *
 * Every control is wrapped in an arrow function rather than passed as a bare
 * reference. React hands the click handler its SyntheticEvent, and a
 * contextBridge function forwards its arguments over IPC, where a
 * SyntheticEvent fails to structured-clone: the call throws "An object could
 * not be cloned" and the send never happens. The wrapper drops the argument.
 */
export function TitleBar(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;

  return (
    <header
      className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg px-2"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      <BrandLockup size={20} className="px-2" />
      <div
        className="flex items-center gap-1"
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
          <Icon icon="ph:square" className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            api.window.close();
          }}
          className="flex h-8 w-[46px] items-center justify-center rounded-md text-text-muted transition-colors duration-hover hover:bg-danger-soft hover:text-danger active:bg-surface-active"
        >
          <Icon icon="ph:x" className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
