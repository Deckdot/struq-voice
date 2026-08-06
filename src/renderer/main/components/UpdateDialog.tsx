import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { MainWindowApi } from "../../../shared/api";
import type { UpdateState } from "../../../shared/updates";
import { Badge, Button, Dialog } from "./ui";

/**
 * The prompt for an update that has already passed the signature gate.
 *
 * It only ever appears on `ready`. Every other phase belongs in the Settings
 * panel: a check that found nothing, a download in flight and a refusal are
 * all things a person can go and look at, and none of them are worth taking
 * the screen for. A verified build waiting to install is, because until
 * someone clicks it nothing happens.
 *
 * Dismissal is per version rather than permanent. "Later" on 0.1.1 must not
 * silence 0.2.0, and the state lives in this component because the main
 * process should not have to remember what a window was told.
 */
export interface UpdateDialogProps {
  readonly api: MainWindowApi;
}

export function UpdateDialog({ api }: UpdateDialogProps): JSX.Element | null {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    void api.updates.get().then(({ state: current }) => {
      setState(current);
    });
    return api.updates.onChange(setState);
  }, [api]);

  if (state === null || state.phase !== "ready") return null;
  if (dismissedVersion === state.version) return null;

  const version = state.version;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setDismissedVersion(version);
      }}
      title={`Version ${version} is ready to install`}
      description="Struq Voice will install in the background and reopen itself. Your settings and history stay the same."
    >
      <Badge tone="success" icon="ph:check-circle">
        Verified against the release signature.
      </Badge>
      <div className="mt-5 flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={installing}
          onClick={() => {
            setDismissedVersion(version);
          }}
        >
          Later
        </Button>
        <Button
          variant="primary"
          disabled={installing}
          onClick={() => {
            // The window can close under the install, so the click is latched
            // here rather than waiting on a resolve that may never arrive.
            setInstalling(true);
            void api.updates.install();
          }}
        >
          {installing ? "Installing..." : "Install and restart"}
        </Button>
      </div>
      {installing && (
        // A click during a capture is held until the capture ends, so the
        // dialog says why nothing appears to be happening.
        <p className="mt-3 text-right text-xs text-text-muted">
          Waiting for the current dictation to finish, if there is one.
        </p>
      )}
    </Dialog>
  );
}
