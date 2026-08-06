import type { JSX } from "react";

export interface RecordingBallProps {
  readonly className?: string;
}

/** The supplied recording mark, themed through currentColor with smooth infinite CSS keyframe bouncing animation. */
export function RecordingBall({ className = "h-4 w-4" }: RecordingBallProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`shrink-0 text-success ${className}`}
      aria-hidden="true"
    >
      <style>{`
        @keyframes sv-bouncing-ball-anim {
          0% {
            transform: translateY(0px) scale(1, 1);
            animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
          }
          44% {
            transform: translateY(14.5px) scale(1, 1);
            animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
          }
          50% {
            transform: translateY(15.5px) scale(1.25, 0.72);
            animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
          }
          56% {
            transform: translateY(14.5px) scale(0.92, 1.08);
            animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
          }
          100% {
            transform: translateY(0px) scale(1, 1);
          }
        }
        .sv-bouncing-ball-element {
          transform-origin: 12px 20px;
          animation: sv-bouncing-ball-anim 0.8s infinite;
        }
      `}</style>
      <ellipse className="sv-bouncing-ball-element" cx="12" cy="4.5" rx="4" ry="4" fill="currentColor" />
    </svg>
  );
}
