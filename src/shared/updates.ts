/**
 * What the app knows about a pending update.
 *
 * Shared between the main process, which drives the check, and the renderer,
 * which draws it in Settings. No side effects and no Electron imports, so it
 * runs in any process.
 */

/**
 * `refused` is a distinct phase on purpose, and it is why this is a union
 * rather than a boolean plus a message.
 *
 * A failed signature check is not "no update available". It means someone
 * served bytes that did not come from the release key, and collapsing that into
 * idle would make an attack look exactly like a quiet morning. The app has to
 * be able to say which of those happened.
 */
export type UpdateState =
  | { readonly phase: "idle"; readonly note?: string }
  | { readonly phase: "checking" }
  | { readonly phase: "downloading"; readonly percent: number }
  | { readonly phase: "ready"; readonly version: string }
  | { readonly phase: "refused"; readonly reason: string }
  | { readonly phase: "error"; readonly message: string };

export const INITIAL_UPDATE_STATE: UpdateState = { phase: "idle" };

/** One line of copy per phase, so main and renderer never disagree. */
export const describeUpdateState = (state: UpdateState): string => {
  switch (state.phase) {
    case "checking":
      return "Checking for updates...";
    case "downloading":
      return `Downloading update, ${String(Math.round(state.percent))}%`;
    case "ready":
      return `Version ${state.version} is ready to install`;
    case "refused":
      // Deliberately blunt. This is the one state a person must not skim past.
      return `Update refused: ${state.reason}`;
    case "error":
      return state.message;
    case "idle":
      return state.note ?? "Up to date";
  }
};
