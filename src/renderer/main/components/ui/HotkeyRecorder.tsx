import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { domEventToAccelerator } from "../../../../shared/hotkeys";
import { Button } from "./Button";
import { Kbd } from "./Kbd";
import { cn } from "../../lib/cn";

/**
 * A two-mode control that shows the current chord and records a new one.
 * Recording is button-focused rather than a global key listener: a global
 * listener would swallow the user's next keystroke anywhere in the app.
 * Escape cancels without changing anything.
 */
export interface HotkeyRecorderProps {
  readonly accelerator: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly conflict?: string;
  readonly size?: "sm" | "md";
}

export function HotkeyRecorder({
  accelerator,
  onChange,
  label,
  conflict,
  size = "sm"
}: HotkeyRecorderProps): JSX.Element {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [recording]);

  if (recording) {
    return (
      <div className="relative flex flex-col items-end min-h-[36px] justify-center">
        <button
          type="button"
          autoFocus
          aria-label={`${label}: press the new chord, Escape to cancel`}
          onBlur={() => {
            setRecording(false);
          }}
          onKeyDown={(event) => {
            event.preventDefault();
            if (event.key === "Escape") {
              setRecording(false);
              return;
            }
            const next = domEventToAccelerator({
              key: event.key,
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              altKey: event.altKey,
              metaKey: event.metaKey
            });
            if (next === null) return;
            setRecording(false);
            onChange(next);
          }}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-dashed border-accent bg-surface px-3 text-sm text-accent-text"
          )}
        >
          <Icon icon="ph:keyboard" className="h-4 w-4 animate-pulse" aria-hidden="true" />
          Press a chord
        </button>
        <span className="absolute -bottom-4 text-2xs text-text-muted whitespace-nowrap">Esc to cancel</span>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-end min-h-[36px] justify-center">
      <div className="flex items-center gap-2">
        <Kbd accelerator={accelerator} size={size} />
        <Button
          variant="secondary"
          size={size}
          aria-label={`Change ${label}`}
          onClick={() => {
            setRecording(true);
          }}
        >
          Change
        </Button>
      </div>
      {conflict !== undefined && conflict.length > 0 && (
        <span className="absolute -bottom-4 text-2xs text-warning whitespace-nowrap">{conflict}</span>
      )}
    </div>
  );
}
