import type { JSX } from "react";
import { Check } from "lucide-react";
import type { OnboardingProfileResult } from "../../../shared/ipc";
import { findModel } from "../../../shared/models";
import { Badge, Card, ProgressBar, formatBytes } from "../components/ui";

/**
 * Step three. The download started when onboarding mounted, so by the time
 * anyone reads this it is already underway: nobody's first experience of the
 * app should be watching a progress bar from zero.
 *
 * The recommendation names the hardware it saw. A choice presented without
 * its reasoning reads as a guess, and the user has no way to judge it.
 */
export interface EngineStepProps {
  readonly profile: OnboardingProfileResult | null;
  readonly receivedBytes: number;
  readonly bytesPerSecond: number | null;
  readonly installed: boolean;
  readonly failure: string | null;
}

export function EngineStep({
  profile,
  receivedBytes,
  bytesPerSecond,
  installed,
  failure
}: EngineStepProps): JSX.Element {
  if (profile === null) {
    return (
      <Card>
        <p className="text-sm text-text-muted">Checking what this machine can run.</p>
      </Card>
    );
  }

  const { recommendation } = profile;
  const model = findModel(recommendation.modelId);
  const totalBytes = model?.bytes ?? 0;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-text">{model?.name ?? recommendation.modelId}</h2>
          <p className="mt-0.5 text-sm leading-snug text-text-muted">{recommendation.reason}</p>
        </div>
        {installed ? (
          <Badge tone="success">
            <Check className="h-3 w-3" aria-hidden="true" /> Ready
          </Badge>
        ) : (
          <Badge tone="neutral">{formatBytes(totalBytes)}</Badge>
        )}
      </div>

      <div className="mt-3">
        {failure !== null ? (
          <p className="text-sm text-danger">
            {failure} You can retry from the Models view once setup is done.
          </p>
        ) : installed ? (
          <p className="text-sm text-text-muted">
            Runs entirely on this machine. Nothing you say leaves it.
          </p>
        ) : (
          <ProgressBar
            receivedBytes={receivedBytes}
            totalBytes={totalBytes}
            bytesPerSecond={bytesPerSecond}
            label={`Downloading ${model?.name ?? "the model"}`}
          />
        )}
      </div>

      {!installed && failure === null && (
        <p className="mt-2 text-xs text-text-muted">
          Downloading in the background. Carry on with setup, this does not need watching.
        </p>
      )}
    </Card>
  );
}
