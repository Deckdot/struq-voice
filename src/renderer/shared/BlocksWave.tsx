import { useId } from "react";
import type { JSX } from "react";
import { useReducedMotion } from "motion/react";
import blocksWaveSvg from "../../../blocks-wave.svg?raw";

export interface BlocksWaveProps {
  readonly className?: string;
}

/** The blocks-wave SVG animation, themed through currentColor. */
export function BlocksWave({ className = "h-5 w-5" }: BlocksWaveProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const instanceId = useId().replaceAll(":", "");

  // Replace default fill with currentColor and unique animate IDs
  const markup = blocksWaveSvg
    .replaceAll('fill="hsl(228, 97%, 42%)"', 'fill="currentColor"')
    .replaceAll("spinner_oJFS", `${instanceId}_wave_start`)
    .replaceAll("spinner_5T1J", `${instanceId}_wave_end`);

  if (reducedMotion === true) {
    return (
      <svg viewBox="0 0 24 24" className={`${className} shrink-0 text-info`} aria-hidden="true">
        <rect x="8" y="8" width="8" height="8" fill="currentColor" />
      </svg>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 text-info [&>svg]:h-full [&>svg]:w-full ${className}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
