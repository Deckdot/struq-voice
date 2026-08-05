import { useState } from "react";
import type { JSX } from "react";
import { Keyboard } from "lucide-react";
import { domEventToAccelerator } from "../../../../shared/hotkeys";
import { Button } from "./Button";
import { Kbd } from "./Kbd";

/**
 * Shows the current chord and records a new one. Used by both onboarding and
 * Settings, so the two can never drift on what counts as a valid chord.
 *
 * Recording is a focused button rather than a global key listener: a listener
 * on the window would swallow the user's next keystroke anywhere in the app.
 * Escape leaves recording without changing anything.
 */
export interface HotkeyCaptureProps {
  readonly accelerator: string;
  readonly onChange: (accelerator: string) => void;
  readonly size?: "sm" | "md";
  /** Labels the recording button for screen readers. */
  readonly label: string;
}

export function HotkeyCapture({
  accelerator,
  onChange,
  size = "sm",
  label
}: HotkeyCaptureProps): JSX.Element {
  const [recording, setRecording] = useState(false);

  if (recording) {
    return (
      <button
        type="button"
        autoFocus
        aria-label={`${label}: press the new chord`}
        onBlur={() => {
          setRecording(false);
        }}
        onKeyDown={(event) => {
          event.preventDefault();
          if (event.key === "Escape") {
            setRecording(false);
            return;
          }
          const next = domEventToAccelerator(event);
          // Modifier-only presses map to null. Stay recording: the user is
          // mid-chord and has not pressed the trigger key yet.
          if (next === null) return;
          setRecording(false);
          onChange(next);
        }}
        className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-dashed border-accent bg-accent-soft px-3 text-sm text-accent-text"
      >
        <Keyboard className="h-4 w-4" aria-hidden="true" />
        Press a chord
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Kbd accelerator={accelerator} size={size} />
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Change ${label}`}
        onClick={() => {
          setRecording(true);
        }}
      >
        Change
      </Button>
    </div>
  );
}
