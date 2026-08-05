import type { CSSProperties, JSX } from "react";
import { Minus, Square, X } from "lucide-react";
import type { MainWindowApi } from "../../../shared/api";
import { BrandLockup } from "./Brand";

/**
 * The custom title bar of the frameless main window. Draggable via the
 * native -webkit-app-region, which requires the buttons to opt out.
 */
export function TitleBar(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;

  return (
    <header
      className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg px-2"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      <BrandLockup className="w-44 px-2" />
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
        <button
          type="button"
          aria-label="Minimize"
          onClick={api.window.minimize}
          className="flex h-7 w-9 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-surface-hover hover:text-text"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Toggle maximize"
          onClick={api.window.toggleMaximize}
          className="flex h-7 w-9 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-surface-hover hover:text-text"
        >
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={api.window.close}
          className="flex h-7 w-9 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-danger-soft hover:text-danger"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
