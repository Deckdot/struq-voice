import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { motion, AnimatePresence } from "motion/react";
import type { CaptureState } from "../../../shared/capture";
import type { Settings } from "../../../shared/settings";
import { Kbd, StatusDot } from "../components/ui";

/**
 * Step four. The user holds the key and says something. This is the
 * emotional peak of setup: a real capture, with the same states the
 * floating pill shows, plus a transcript result that proves it worked.
 */

const PHASE_LABEL: Record<string, string> = {
  idle: "Press your key when you are ready.",
  arming: "Reopening the microphone.",
  listening: "Listening. Speak when you are ready.",
  transcribing: "Turning your words into text.",
  delivering: "Done. That just landed in the app you were using.",
  error: "Something went wrong. Try again."
};

export interface TryItStepProps {
  readonly settings: Settings;
  readonly capture: CaptureState;
  readonly transcript: string | null;
  readonly modelReady: boolean;
}

export function TryItStep({
  settings,
  capture,
  transcript,
  modelReady
}: TryItStepProps): JSX.Element {
  const phase = capture.phase;
  const state = ((): "idle" | "listening" | "transcribing" | "delivering" | "error" => {
    if (phase === "listening" || phase === "arming") return "listening";
    if (phase === "transcribing") return "transcribing";
    if (phase === "delivering") return "delivering";
    if (phase === "error") return "error";
    return "idle";
  })();
  const label = PHASE_LABEL[phase] ?? PHASE_LABEL["idle"] ?? "Press your key when you are ready.";

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm text-text">
            <StatusDot state={state} />
            {label}
          </p>
          <Kbd accelerator={settings.pttAccelerator} size="md" />
        </div>
        {!modelReady && (
          <p className="mt-3 text-sm text-text-muted">
            The model is still downloading. You can come back to this step once it lands. The key
            works everywhere in Windows, so there is nothing else to come back to.
          </p>
        )}
      </div>

      <AnimatePresence>
        {transcript !== null && transcript.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-lg border border-accent bg-surface p-4"
          >
            <div className="flex items-center gap-2">
              <Icon icon="ph:check-circle" className="h-4 w-4 text-accent-text" aria-hidden="true" />
              <p className="text-sm font-medium text-accent-text">That is what Struq Voice heard:</p>
            </div>
            <p className="mt-2 font-display text-lg leading-prose text-text" data-selectable>
              {transcript}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
