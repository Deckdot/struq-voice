import type { JSX } from "react";
import type { Settings } from "../../../shared/settings";
import { HotkeyRecorder } from "../components/ui";
import { ReadyRow } from "./StepShell";

/**
 * Step two. Both chords are already registered and working, so this step
 * offers a change rather than demanding a choice. The user can read what
 * the keys are and move on in one click.
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
          <HotkeyRecorder
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
        label="Press to toggle"
        value="Press once to start, once to stop. Useful for longer dictation."
        ready
        action={
          <HotkeyRecorder
            label="press to toggle key"
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
