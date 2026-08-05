import type { JSX } from "react";
import type { Settings } from "../../../shared/settings";
import { HotkeyCapture } from "../components/ui";
import { ReadyRow } from "./StepShell";

/**
 * Step two. Both chords are already registered and working, so this step
 * offers a change rather than demanding a choice: the user can read what the
 * keys are and move on in one click.
 */
export interface HotkeyStepProps {
  readonly settings: Settings;
  readonly onChange: (patch: Partial<Settings>) => void;
}

export function HotkeyStep({ settings, onChange }: HotkeyStepProps): JSX.Element {
  return (
    <>
      <ReadyRow
        label="Hold to record"
        value="Hold anywhere in Windows, speak, release. The text lands in whatever field you were in."
        ready
        action={
          <HotkeyCapture
            label="hold to record key"
            accelerator={settings.pttAccelerator}
            size="md"
            onChange={(pttAccelerator) => {
              onChange({ pttAccelerator });
            }}
          />
        }
      />
      <ReadyRow
        label="Toggle recording"
        value="Press once to start, once to stop. For dictation longer than a held key is comfortable."
        ready
        action={
          <HotkeyCapture
            label="toggle recording key"
            accelerator={settings.toggleAccelerator}
            onChange={(toggleAccelerator) => {
              onChange({ toggleAccelerator });
            }}
          />
        }
      />
    </>
  );
}
