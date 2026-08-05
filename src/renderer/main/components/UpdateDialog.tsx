import { useEffect, useState } from "react";
import type { JSX } from "react";
import { ArrowUpCircle, ShieldCheck } from "lucide-react";
import type { MainWindowApi } from "../../../shared/api";
import type { UpdateState } from "../../../shared/updates";
import { Button } from "./ui";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/20">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        className="w-[26rem] max-w-[calc(100vw-4rem)] rounded-lg border border-border bg-surface p-5 shadow-float"
      >
        <div className="flex items-start gap-3">
          <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-text" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="update-dialog-title" className="text-base font-medium text-text">
              Version {version} is ready
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Struq Voice installs it in the background and reopens itself. Your
              settings and history are kept.
            </p>
          </div>
        </div>

        <p className="mt-4 flex items-center gap-2 text-xs text-text-muted">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Verified against the release signature.
        </p>

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
            Finishing the current dictation first, if there is one.
          </p>
        )}
      </div>
    </div>
  );
}
