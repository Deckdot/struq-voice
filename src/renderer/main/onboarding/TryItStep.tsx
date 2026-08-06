import type { JSX } from "react";
import { Check } from "lucide-react";
import type { CaptureState } from "../../../shared/capture";
import type { Settings } from "../../../shared/settings";
import { Card, Kbd, StatusDot } from "../components/ui";

/**
 * Step four: the user does the thing rather than watching a demonstration.
 * The transcript that appears here is their own sentence, which is both the
 * proof the setup worked and the moment the product explains itself.
 *
 * If the model has not finished downloading this says so plainly instead of
 * inviting a capture that would fail.
 */
export interface TryItStepProps {
  readonly settings: Settings;
  readonly capture: CaptureState;
  readonly transcript: string | null;
  readonly modelReady: boolean;
}

const PHASE_LABEL: Record<CaptureState["phase"], string> = {
  idle: "Waiting for the key",
  arming: "Warming up the microphone",
  listening: "Listening",
  transcribing: "Transcribing",
  delivering: "Delivered",
  error: "Did not work"
};

export function TryItStep({
  settings,
  capture,
  transcript,
  modelReady
}: TryItStepProps): JSX.Element {
  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm text-text">
            <StatusDot
              state={
                capture.phase === "listening" || capture.phase === "arming"
                  ? "listening"
                  : capture.phase === "transcribing"
                    ? "transcribing"
                    : capture.phase === "delivering"
                      ? "delivering"
                      : capture.phase === "error"
                        ? "error"
                        : "idle"
              }
            />
            {PHASE_LABEL[capture.phase]}
          </p>
          <Kbd accelerator={settings.pttAccelerator} size="md" />
        </div>

        {!modelReady && (
          <p className="mt-3 text-sm text-text-muted">
            The model is still downloading. Finish setup and try this once it lands: the
            key works everywhere in Windows, so there is nothing else to come back to.
          </p>
        )}

        {modelReady && transcript === null && (
          <p className="mt-3 text-sm text-text-muted">
            Hold the key, say a sentence, then release. What you said appears below.
          </p>
        )}

        {transcript !== null && (
          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-xs text-success">
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> That is your setup working
            </p>
            <p className="mt-2 max-w-prose font-serif text-lg leading-prose text-text">
              {transcript}
            </p>
          </div>
        )}

        {capture.phase === "error" && (
          <p className="mt-3 text-sm text-danger">{capture.message}</p>
        )}
      </Card>

      <p className="text-sm text-text-muted">
        From here on the app lives in the tray. The key works in any application:
        the browser, an editor, a chat window.
      </p>
    </>
  );
}
