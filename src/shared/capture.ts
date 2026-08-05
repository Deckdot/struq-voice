/**
 * Capture state, shared by every surface: tray, overlay, main window, tests.
 * The session in src/main/session/capture-session.ts is the single authority;
 * everything else renders from broadcasts of this union.
 */

export type CapturePhase =
  | "idle"
  | "arming"
  | "listening"
  | "transcribing"
  | "delivering"
  | "error";

export type CaptureState =
  | { readonly phase: "idle" }
  | { readonly phase: "arming"; readonly reason: string }
  | { readonly phase: "listening"; readonly startedAtMs: number }
  | {
      readonly phase: "transcribing";
      readonly engineId: string;
      readonly startedAtMs: number;
    }
  | {
      readonly phase: "delivering";
      readonly text: string;
      readonly inserted: boolean;
    }
  | {
      readonly phase: "error";
      readonly message: string;
      readonly text: string | null;
    };

export const INITIAL_CAPTURE_STATE: CaptureState = { phase: "idle" };

export const isActiveCapture = (state: CaptureState): boolean =>
  state.phase !== "idle";
