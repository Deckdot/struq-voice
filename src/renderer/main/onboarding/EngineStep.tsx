import type { JSX } from "react";
import type { OnboardingProfileResult } from "../../../shared/ipc";
import { findModel } from "../../../shared/models";
import { Badge, Card, ProgressBar, formatBytes } from "../components/ui";
import { ReadyRow } from "./StepShell";

/**
 * Step three. The download started when onboarding mounted, so by the
 * time anyone reads this it is already underway. The recommendation names
 * the hardware it saw, so the user can decide whether to trust it.
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
  void bytesPerSecond;
  if (profile === null) {
    return (
      <Card>
        <p className="text-sm text-text-muted">Looking at this computer to pick a model.</p>
      </Card>
    );
  }

  const { recommendation } = profile;
  const model = findModel(recommendation.modelId);
  const totalBytes = model?.bytes ?? 0;
  const engineLabel = recommendation.engineId === "parakeet" ? "Parakeet" : "Whisper";
  const progress = totalBytes > 0 ? receivedBytes / totalBytes : 0;
  const downloading = !installed && failure === null;

  return (
    <ReadyRow
      label={model?.name ?? recommendation.modelId}
      value={`${engineLabel} on this computer. ${recommendation.reason}`}
      ready={installed}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{model?.languages ?? ""}</Badge>
          <Badge tone="neutral">{formatBytes(totalBytes)}</Badge>
          {installed ? (
            <Badge tone="success" icon="check-circle">
              Ready to use
            </Badge>
          ) : failure !== null ? (
            <Badge tone="danger">{failure}</Badge>
          ) : (
            <Badge tone="ember" icon="download-simple">
              Downloading
            </Badge>
          )}
        </div>
        {downloading && <ProgressBar value={progress} tone="ember" label="Downloading model" />}
        <p className="text-2xs text-text-muted">
          Downloading in the background. Carry on with the next step.
        </p>
      </div>
    </ReadyRow>
  );
}
