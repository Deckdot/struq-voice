import type { CSSProperties, JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";

/**
 * The custom title bar of the frameless main window. Draggable via the
 * native -webkit-app-region, which requires the buttons to opt out.
 *
 * The caption buttons follow the Windows 11 metrics rather than a web
 * convention: 46x36, square, flush into the top-right corner with no gap
 * and no rounding, and close fills with the system red on hover. That red
 * is hard-coded because it is a Windows constant, not a brand colour, and
 * it stays the same in both themes.
 *
 * Every control is wrapped in an arrow function rather than passed as a bare
 * reference. React hands the click handler its SyntheticEvent, and a
 * contextBridge function forwards its arguments over IPC, where a
 * SyntheticEvent fails to structured-clone: the call throws "An object could
 * not be cloned" and the send never happens. The wrapper drops the argument.
 */
const CONTROL_BASE =
  "flex h-9 w-[46px] items-center justify-center text-text-secondary transition-colors duration-hover hover:bg-surface-hover hover:text-text active:bg-surface-active";

export function TitleBar(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;

  return (
    <header
      className="relative flex h-9 shrink-0 items-center justify-end border-b border-border bg-bg"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      <span className="pointer-events-none absolute inset-x-0 text-center text-xs font-medium tracking-wide text-text-secondary">
        Struq
      </span>
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
