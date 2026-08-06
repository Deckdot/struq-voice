import { useId } from "react";
import type { JSX } from "react";
import { useReducedMotion } from "motion/react";
import bouncingBallSvg from "../../../bouncing-ball.svg?raw";

export interface RecordingBallProps {
  readonly className?: string;
}

/** The supplied recording mark, themed through currentColor and static when motion is reduced. */
export function RecordingBall({ className = "h-4 w-4" }: RecordingBallProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const instanceId = useId().replaceAll(":", "");
  const markup = bouncingBallSvg
    .replaceAll("spinner_jbYs", `${instanceId}_drop`)
    .replaceAll("spinner_ADF4", `${instanceId}_squash`)
    .replaceAll("spinner_JZdr", `${instanceId}_rise`);

  if (reducedMotion === true) {
    return (
      <svg viewBox="0 0 24 24" className={`${className} shrink-0 text-success`} aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="currentColor" />
      </svg>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 text-success [&>svg]:h-full [&>svg]:w-full ${className}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
