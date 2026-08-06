import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import type { ModelStatus } from "../../../shared/models";
import { findModel } from "../../../shared/models";
import { WHISPER_TIER_ORDER, whisperVariant } from "../../../shared/models";
import type { WhisperTier } from "../../../shared/models";
import {
  Badge,
  Button,
  Card,
  ModelRow,
  ProgressBar,
  SegmentedControl,
  formatBytes
} from "../components/ui";
import type { SpeedLabel } from "../components/ui";

/**
 * The Models view. One model this computer should run, named with the
 * hardware that chose it, then the full catalog for anyone who wants to
 * pick a different one. Live speed is shown when an engine has produced
 * a measured realtime factor; otherwise a tier label.
 */

const TIER_LABEL: Record<WhisperTier | "all", string> = {
  all: "All sizes",
  tiny: "Tiny",
  base: "Base",
  small: "Small",
  medium: "Medium",
  large: "Large"
};

const TIER_SPEED: Record<WhisperTier, SpeedLabel> = {
  tiny: "Fast",
  base: "Fast",
  small: "Balanced",
  medium: "Balanced",
  large: "High accuracy"
};

type TierFilter = WhisperTier | "all";

const sortModels = (items: readonly ModelStatus[]): ModelStatus[] =>
  [...items].sort((a, b) => {
    const va = whisperVariant(a.model.id);
    const vb = whisperVariant(b.model.id);
    if (va === null && vb === null) return a.model.name.localeCompare(b.model.name);
    if (va === null) return -1;
    if (vb === null) return 1;
    const tierDelta =
      WHISPER_TIER_ORDER.indexOf(va.tier) - WHISPER_TIER_ORDER.indexOf(vb.tier);
    if (tierDelta !== 0) return tierDelta;
    return a.model.bytes - b.model.bytes;
  });

export function ModelsView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [statuses, setStatuses] = useState<readonly ModelStatus[]>([]);
  const [diskUsed, setDiskUsed] = useState(0);
  const [runtime, setRuntime] = useState<{ state: "idle" | "downloading" | "done" | "error"; receivedBytes?: number; totalBytes?: number; message?: string }>({ state: "idle" });
  const [measuredRtf, setMeasuredRtf] = useState<Record<string, number>>({});
  const [tier, setTier] = useState<TierFilter>("all");
  const [englishOnly, setEnglishOnly] = useState(false);
  const [recommendation, setRecommendation] = useState<{
    modelId: string;
    reason: string;
    engineId: string;
  } | null>(null);
  const [activeSelection, setActiveSelection] = useState<{ primary: string; whisperModelId: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = (): void => {
    void api.models.list().then(({ items, totalDiskUsed, whisperRuntime }) => {
      setStatuses(items);
      setDiskUsed(totalDiskUsed);
      setRuntime(whisperRuntime);
    });
    void api.metrics.measuredRtf().then(({ byEngine }) => {
      setMeasuredRtf(byEngine);
    });
  };

  useEffect(() => {
    void api.onboarding.profile().then((profile) => {
      setRecommendation({
        modelId: profile.recommendation.modelId,
        reason: profile.recommendation.reason,
        engineId: profile.recommendation.engineId
      });
    });
    void api.settings.get().then(({ settings }) => {
      setActiveSelection({ primary: settings.engine.primary, whisperModelId: settings.whisperModelId });
    });
    const onSettingsChange = api.settings.onChange((settings) => {
      setActiveSelection({ primary: settings.engine.primary, whisperModelId: settings.whisperModelId });
    });
    return () => {
      onSettingsChange();
    };
  }, [api]);

  useEffect(() => {
    refresh();
    const unsubscribe = api.models.onDownloadProgress(() => {
      refresh();
    });
    return () => {
      unsubscribe();
    };
  }, [api]);

  const filtered = sortModels(
    statuses.filter((status) => {
      const variant = whisperVariant(status.model.id);
      if (variant === null) return tier === "all" && !englishOnly;
      if (tier !== "all" && variant.tier !== tier) return false;
      if (englishOnly && !variant.englishOnly) return false;
      return true;
    })
  );

  const isModelActive = (status: ModelStatus): boolean => {
    if (activeSelection === null) return false;
    if (status.model.engine === "parakeet") {
      return activeSelection.primary === "parakeet" && activeSelection.whisperModelId === "";
    }
    return (
      activeSelection.primary === "whisper-cpp" &&
      activeSelection.whisperModelId === status.model.id
    );
  };

  const startRecommended = (): void => {
    setErrorMessage(null);
    void api.onboarding.startRecommended().then((result) => {
      if (!result.started && result.message !== undefined && !result.message.startsWith("Already")) {
        setErrorMessage(result.message);
      }
      refresh();
    });
  };

  const selectModel = (status: ModelStatus): void => {
    if (status.model.engine === "parakeet") {
      void api.settings.update({ engine: { primary: "parakeet", fallback: null }, whisperModelId: "" });
      return;
    }
    void api.settings.update({
      engine: { primary: "whisper-cpp", fallback: null },
      whisperModelId: status.model.id
    });
  };

  const recommendedModel = recommendation !== null ? findModel(recommendation.modelId) : null;
  const recommendedStatus = recommendation !== null
    ? statuses.find((status) => status.model.id === recommendation.modelId)
    : undefined;
  const recommendedEngineLabel = recommendation?.engineId === "parakeet" ? "Parakeet" : "Whisper";

  const recommendedDownloading =
    recommendedStatus !== undefined && recommendedStatus.download.state === "downloading";
  const recommendedProgress =
    recommendedStatus?.download.state === "downloading"
      ? Math.min(
          1,
          Math.max(0, recommendedStatus.download.receivedBytes / Math.max(1, recommendedStatus.download.totalBytes))
        )
      : null;

  const runtimeDownloading = runtime.state === "downloading";
  const runtimeDone = runtime.state === "done";
  const runtimeError = runtime.state === "error";
  const runtimeProgress =
    runtimeDownloading && runtime.totalBytes !== undefined && runtime.totalBytes > 0
      ? Math.min(1, Math.max(0, (runtime.receivedBytes ?? 0) / runtime.totalBytes))
      : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex flex-col gap-2 border-b border-border px-8 py-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Models</h1>
        <p className="max-w-prose text-sm text-text-muted">
          The voice helpers that live on this computer. Download the one that suits your machine, or
          import a folder you already have. The cloud service is configured in Settings, not here.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-10">
          {recommendedModel !== null && recommendation !== null && (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-text">
                  Best for this computer
                </h2>
                <p className="mt-0.5 text-sm text-text-muted">
                  {recommendation.reason}
                </p>
              </div>
              <Card className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-text">{recommendedModel.name}</h3>
                      <Badge tone="neutral">{recommendedEngineLabel}</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-text-muted">{recommendedModel.whenToUse}</p>
                    <p className="mt-1 text-2xs text-text-muted" data-numeric>
                      {recommendedModel.languages} · {formatBytes(recommendedModel.bytes)}
                    </p>
                  </div>
                  {recommendedStatus?.installed === true ? (
                    <Badge tone="success" icon="check-circle">
                      Ready to use
                    </Badge>
                  ) : recommendedDownloading && recommendedProgress !== null ? (
                    <Badge tone="ember" icon="download-simple">
                      {Math.round(recommendedProgress * 100)}%
                    </Badge>
                  ) : (
                    <Button variant="primary" size="md" onClick={startRecommended}>
                      <Icon icon="ph:download-simple" className="h-3.5 w-3.5" aria-hidden="true" />
                      Download and use
                    </Button>
                  )}
                </div>
                {recommendedDownloading && recommendedProgress !== null && (
                  <ProgressBar value={recommendedProgress} tone="ember" label="Downloading" />
                )}
                {errorMessage !== null && (
                  <p className="text-sm text-danger" role="alert">
                    {errorMessage}
                  </p>
                )}
              </Card>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-text">All models</h2>
              <p className="mt-0.5 text-sm text-text-muted">
                Smaller downloads are quicker. Larger models are better with accents and noise.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl<TierFilter>
                options={(["all", ...WHISPER_TIER_ORDER] as const).map((value) => ({
                  value,
                  label: TIER_LABEL[value]
                }))}
                value={tier}
                onChange={setTier}
                size="sm"
              />
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={englishOnly}
                  onChange={(event) => {
                    setEnglishOnly(event.target.checked);
                  }}
                  className="h-3.5 w-3.5 cursor-pointer accent-[var(--sv-accent)]"
                />
                English only
              </label>
              <span className="ml-auto text-xs text-text-muted" data-numeric>
                {String(filtered.length)} of {String(statuses.length)}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {filtered.map((status) => {
                const variant = whisperVariant(status.model.id);
                const speed: SpeedLabel = variant !== null ? TIER_SPEED[variant.tier] : "Balanced";
                const measured = measuredRtf[status.model.engine];
                return (
                  <ModelRow
                    key={status.model.id}
                    status={status}
                    active={isModelActive(status)}
                    speedLabel={speed}
                    {...(measured !== undefined ? { measuredRtf: measured } : {})}
                    onDownload={() => {
                      void api.models.download({ modelId: status.model.id }).then(refresh);
                    }}
                    onCancel={() => {
                      void api.models.cancel({ modelId: status.model.id }).then(refresh);
                    }}
                    onRetry={() => {
                      void api.models.download({ modelId: status.model.id }).then(refresh);
                    }}
                    onRemove={() => {
                      void api.models.remove({ modelId: status.model.id }).then(refresh);
                    }}
                    onSelect={() => {
                      selectModel(status);
                    }}
                    onImport={() => {
                      void api.models.import({ modelId: status.model.id }).then(refresh);
                    }}
                  />
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-text">Whisper helper</h2>
              <p className="mt-0.5 text-sm text-text-muted">
                A small file Struq Voice needs in order to run the Whisper family of models. It
                usually installs itself the first time you start the app.
              </p>
            </div>
            <Card>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-text">
                    {runtimeDone
                      ? "Installed and ready."
                      : runtimeDownloading
                        ? `Downloading ${runtimeProgress !== null ? `${String(Math.round(runtimeProgress * 100))}%` : "..."}`
                        : runtimeError
                          ? (runtime.message ?? "The helper download failed.")
                          : "Not installed yet."}
                  </p>
                  {runtimeDownloading && runtimeProgress !== null && (
                    <ProgressBar value={runtimeProgress} tone="accent" className="mt-2" label="Downloading helper" />
                  )}
                </div>
                {runtimeDone ? (
                  <Badge tone="success" icon="check-circle">
                    Ready
                  </Badge>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={runtimeDownloading}
                    onClick={() => {
                      void api.models.installRuntime().then(refresh);
                    }}
                  >
                    {runtimeDownloading ? (
                      <Icon icon="ph:circle-notch" className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
                    ) : (
                      <Icon icon="ph:download-simple" className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {runtimeDownloading ? "Downloading" : "Install helper"}
                  </Button>
                )}
              </div>
            </Card>
          </section>

          <p className="flex items-center gap-1.5 text-2xs text-text-muted" data-numeric>
            <Icon icon="ph:hard-drive" className="h-3.5 w-3.5" aria-hidden="true" />
            {formatBytes(diskUsed)} used by models on this computer
          </p>
        </div>
      </div>
    </div>
  );
}
