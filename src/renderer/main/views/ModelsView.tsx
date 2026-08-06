import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import type { HardwareProfile, MachineTier } from "../../../shared/hardware";
import type { ModelStatus, WhisperTier } from "../../../shared/models";
import { WHISPER_TIER_ORDER, whisperVariant } from "../../../shared/models";
import {
  Badge,
  Button,
  Card,
  Dialog,
  ModelRow,
  ProgressBar,
  SegmentedControl,
  formatBytes
} from "../components/ui";
import type { SpeedLabel } from "../components/ui";
import { ProviderMark } from "../components/ProviderMark";

const TIER_LABEL: Record<WhisperTier, string> = {
  tiny: "Tiny",
  base: "Base",
  small: "Small",
  medium: "Medium",
  large: "Large"
};

const TIER_GUIDANCE: Record<WhisperTier, string> = {
  tiny: "Fastest, smallest download. Good for quick notes on older hardware.",
  base: "Light and quick, handles clear speech well.",
  small: "Best balance of speed and accuracy for most people.",
  medium: "Higher accuracy for accents and noisy environments.",
  large: "Maximum accuracy. Needs a capable PC and more RAM."
};

const TIER_SPEED: Record<WhisperTier, SpeedLabel> = {
  tiny: "Fast",
  base: "Fast",
  small: "Balanced",
  medium: "Balanced",
  large: "High accuracy"
};

const EXTRA_RECOMMENDATIONS: Record<MachineTier, readonly string[]> = {
  light: ["whisper-tiny-q8_0", "whisper-small-q5_1"],
  balanced: ["whisper-small-q8_0", "whisper-medium-q5_0"],
  performance: ["whisper-large-v3-turbo-q8_0", "whisper-large-v3"]
};

const PICK_LABELS: Record<MachineTier, readonly [string, string, string]> = {
  light: ["Best fit", "Fastest", "More detail"],
  balanced: ["Best overall", "Fast and precise", "More accuracy"],
  performance: ["Best overall", "Fast large model", "Maximum accuracy"]
};

const TIER_NAME: Record<MachineTier, string> = {
  light: "Light workload",
  balanced: "Balanced workload",
  performance: "Performance workload"
};

const largeRank = [
  "whisper-large-v3-turbo-q8_0",
  "whisper-large-v3-q5_0",
  "whisper-large-v3"
] as const;

const modelRank = (status: ModelStatus): number => {
  const variant = whisperVariant(status.model.id);
  if (variant === null) return 99;
  if (variant.tier === "large") {
    const preferred = largeRank.indexOf(status.model.id as (typeof largeRank)[number]);
    return preferred === -1 ? 20 + status.model.bytes : preferred;
  }
  if (!variant.englishOnly && variant.quant === "q8_0") return 0;
  if (!variant.englishOnly && variant.quant?.startsWith("q5") === true) return 1;
  if (variant.englishOnly && variant.quant?.startsWith("q5") === true) return 2;
  if (!variant.englishOnly && variant.quant === null) return 3;
  return 4;
};

const sortTier = (items: readonly ModelStatus[]): ModelStatus[] =>
  [...items].sort((a, b) => modelRank(a) - modelRank(b) || a.model.bytes - b.model.bytes);

const progressFor = (status: ModelStatus): number | null => {
  if (status.download.state !== "downloading") return null;
  return Math.min(
    1,
    Math.max(0, status.download.receivedBytes / Math.max(1, status.download.totalBytes))
  );
};

/**
 * Maps a model to a short, human-readable name that avoids all internal
 * jargon. "Whisper large-v3-turbo (q8_0)" becomes "Whisper Large (Balanced)"
 * so anyone can pick without knowing quantisation terminology.
 */
const humanModelName = (status: ModelStatus): string => {
  if (status.model.engine === "parakeet") {
    if (status.model.id.includes("v3")) return "Parakeet TDT v3";
    if (status.model.id.includes("v2")) return "Parakeet TDT v2";
    return "Parakeet";
  }
  const variant = whisperVariant(status.model.id);
  if (variant === null) return status.model.name;
  const tierLabel = TIER_LABEL[variant.tier];
  let qualityLabel: string;
  if (variant.quant === null) {
    qualityLabel = "Full precision";
  } else if (variant.quant === "q8_0") {
    qualityLabel = "Balanced";
  } else if (variant.quant.startsWith("q5")) {
    qualityLabel = "Compact";
  } else {
    qualityLabel = variant.quant;
  }
  const englishNote = variant.englishOnly ? " · English only" : "";
  return `Whisper ${tierLabel} (${qualityLabel}${englishNote})`;
};

interface RecommendationCardProps {
  readonly status: ModelStatus;
  readonly label: string;
  readonly active: boolean;
  readonly onDownload: () => void;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onSelect: () => void;
}

function RecommendationCard({
  status,
  label,
  active,
  onDownload,
  onCancel,
  onRetry,
  onSelect
}: RecommendationCardProps): JSX.Element {
  const progress = progressFor(status);
  const downloading = status.download.state === "downloading";
  const verifying = status.download.state === "verifying";
  const errored = status.download.state === "error";

  return (
    <Card
      className={`flex min-h-[180px] flex-col gap-4 ${active ? "border-accent" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <ProviderMark engine={status.model.engine} className="h-7 w-7" />
        <Badge tone={active ? "accent" : "neutral"} {...(active ? { icon: "ph:check" } : {})}>
          {active ? "Selected" : label}
        </Badge>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-medium leading-snug text-text">
          {humanModelName(status)}
        </h3>
        <p className="mt-2 text-xs text-text-muted" data-numeric>
          {formatBytes(status.model.bytes)} · {status.model.languages}
        </p>
      </div>
      {downloading && progress !== null && (
        <ProgressBar value={progress} tone="accent" label="Downloading model" />
      )}
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="text-xs text-text-muted">
          {status.installed ? "On this PC" : "Download required"}
        </span>
        {downloading || verifying ? (
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={verifying}>
            {verifying ? "Verifying" : "Cancel"}
          </Button>
        ) : errored ? (
          <Button variant="primary" size="sm" onClick={onRetry}>Retry</Button>
        ) : status.installed ? (
          active ? (
            <Icon icon="ph:check-circle" className="h-5 w-5 text-accent" aria-hidden="true" />
          ) : (
            <Button variant="primary" size="sm" onClick={onSelect}>Use model</Button>
          )
        ) : (
          <Button variant="primary" size="sm" onClick={onDownload}>
            <Icon icon="ph:download-simple" className="h-3.5 w-3.5" aria-hidden="true" />
            Download
          </Button>
        )}
      </div>
    </Card>
  );
}

export function ModelsView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [statuses, setStatuses] = useState<readonly ModelStatus[]>([]);
  const [diskUsed, setDiskUsed] = useState(0);
  const [runtime, setRuntime] = useState<{
    state: "idle" | "downloading" | "done" | "error";
    receivedBytes?: number;
    totalBytes?: number;
    message?: string;
  }>({ state: "idle" });
  const [measuredRtf, setMeasuredRtf] = useState<Record<string, number>>({});
  const [tier, setTier] = useState<WhisperTier>("small");
  const [showAllTier, setShowAllTier] = useState(false);
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [recommendation, setRecommendation] = useState<{
    modelId: string;
    reason: string;
    tier: MachineTier;
  } | null>(null);
  const [activeSelection, setActiveSelection] = useState<{
    primary: string;
    whisperModelId: string;
  } | null>(null);
  const [specsOpen, setSpecsOpen] = useState(false);

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
      setHardware(profile.hardware);
      setRecommendation({
        modelId: profile.recommendation.modelId,
        reason: profile.recommendation.reason,
        tier: profile.recommendation.tier
      });
      setTier(
        profile.recommendation.tier === "light"
          ? "base"
          : profile.recommendation.tier === "performance"
            ? "large"
            : "small"
      );
    });
    void api.settings.get().then(({ settings }) => {
      setActiveSelection({
        primary: settings.engine.primary,
        whisperModelId: settings.whisperModelId
      });
    });
    return api.settings.onChange((settings) => {
      setActiveSelection({
        primary: settings.engine.primary,
        whisperModelId: settings.whisperModelId
      });
    });
  }, [api]);

  useEffect(() => {
    refresh();
    return api.models.onDownloadProgress(refresh);
  }, [api]);

  const isModelActive = (status: ModelStatus): boolean => {
    if (activeSelection === null) return false;
    if (status.model.engine === "parakeet") {
      return activeSelection.primary === "parakeet";
    }
    return (
      activeSelection.primary === "whisper-cpp" &&
      activeSelection.whisperModelId === status.model.id
    );
  };

  const selectModel = (status: ModelStatus): void => {
    if (status.model.engine === "parakeet") {
      void api.settings.update({
        engine: { primary: "parakeet", fallback: null },
        whisperModelId: ""
      });
      return;
    }
    void api.settings.update({
      engine: { primary: "whisper-cpp", fallback: null },
      whisperModelId: status.model.id
    });
  };

  const row = (status: ModelStatus): JSX.Element => {
    const variant = whisperVariant(status.model.id);
    const speed = variant === null ? "Balanced" : TIER_SPEED[variant.tier];
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
  };

  const currentStatus = statuses.find(isModelActive);
  const machineTier = recommendation?.tier ?? "balanced";
  const recommendationIds = recommendation === null
    ? []
    : [recommendation.modelId, ...EXTRA_RECOMMENDATIONS[machineTier]];
  const systemPicks = recommendationIds
    .map((modelId) => statuses.find((status) => status.model.id === modelId))
    .filter((status): status is ModelStatus => status !== undefined)
    .slice(0, 3);
  const tierModels = sortTier(
    statuses.filter((status) => whisperVariant(status.model.id)?.tier === tier)
  );
  // Top 3 lightest in the selected tier (smallest download first)
  const lightestTierModels = [...tierModels].sort((a, b) => a.model.bytes - b.model.bytes).slice(0, 3);
  const featuredTierModels = tierModels.slice(0, 3);
  const otherTierModels = tierModels.slice(3);
  const parakeetModels = statuses.filter((status) => status.model.engine === "parakeet");

  const runtimeDownloading = runtime.state === "downloading";
  const runtimeDone = runtime.state === "done";
  const runtimeProgress =
    runtimeDownloading && runtime.totalBytes !== undefined && runtime.totalBytes > 0
      ? Math.min(1, Math.max(0, (runtime.receivedBytes ?? 0) / runtime.totalBytes))
      : null;

  return (
    <div className="h-full overflow-y-auto bg-bg" data-selectable>
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-7 px-6 py-5">
        <div className="flex items-end justify-between gap-5">
          <div>
            <h1 className="font-display text-2xl font-medium tracking-tight text-text">Models</h1>
          </div>
          <Button variant="secondary" size="md" onClick={() => { setSpecsOpen(true); }}>
            <Icon icon="ph:desktop-tower" className="h-4 w-4" aria-hidden="true" />
            PC specs
          </Button>
        </div>

        {/* Honest callout for light machines */}
        {machineTier === "light" && (
          <Card className="border-warning bg-warning-soft">
            <div className="flex items-start gap-3">
              <Icon icon="ph:warning-circle" className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-text">Local transcription may feel slow on this PC</p>
                <p className="mt-1 text-xs text-text-muted">
                  This machine is best suited for the Tiny or Base models. For faster results without a long wait, OpenRouter (cloud) processes audio on a server and returns a transcript quickly.
                </p>
              </div>
            </div>
          </Card>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between gap-4">
            <h2 className="font-display text-lg font-medium text-text">Active model</h2>
          </div>
          <Card className={currentStatus === undefined ? "" : "border-accent"}>
            {currentStatus === undefined ? (
              <div className="flex items-center gap-3">
                <Icon icon="ph:cloud" className="h-6 w-6 text-text-muted" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-text">No local model selected</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Choose an installed model below to run transcription on this computer.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <ProviderMark engine={currentStatus.model.engine} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-base font-medium text-text">
                      {humanModelName(currentStatus)}
                    </p>
                    <Badge tone="accent" icon="ph:check">Active</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-text-muted" data-numeric>
                    {currentStatus.model.languages} · {formatBytes(currentStatus.model.bytes)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-success">Ready</p>
                </div>
              </div>
            )}
          </Card>
        </section>

        <section>
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-medium text-text">Recommended for this PC</h2>
              <Badge tone="neutral">{TIER_NAME[machineTier]}</Badge>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {recommendation?.reason ?? "Reading your processor, memory, and graphics hardware."}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {systemPicks.map((status, index) => (
              <RecommendationCard
                key={status.model.id}
                status={status}
                label={PICK_LABELS[machineTier][index] ?? "Recommended"}
                active={isModelActive(status)}
                onDownload={() => {
                  void api.models.download({ modelId: status.model.id }).then(refresh);
                }}
                onCancel={() => {
                  void api.models.cancel({ modelId: status.model.id }).then(refresh);
                }}
                onRetry={() => {
                  void api.models.download({ modelId: status.model.id }).then(refresh);
                }}
                onSelect={() => {
                  selectModel(status);
                }}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-medium text-text">Whisper models</h2>
              <p className="mt-0.5 text-xs text-text-muted">{TIER_GUIDANCE[tier]}</p>
            </div>
            <SegmentedControl<WhisperTier>
              options={WHISPER_TIER_ORDER.map((value) => ({ value, label: TIER_LABEL[value] }))}
              value={tier}
              onChange={(next) => {
                setTier(next);
                setShowAllTier(false);
              }}
              size="md"
            />
          </div>

          {/* Top 3 lightest in the selected size */}
          {lightestTierModels.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium text-text-muted">Lightest downloads</p>
              <div className="flex flex-col gap-2">
                {lightestTierModels.map(row)}
              </div>
            </div>
          )}

          <p className="mb-2 text-xs font-medium text-text-muted">All {TIER_LABEL[tier].toLowerCase()} variants</p>
          <div className="flex flex-col gap-2">
            {featuredTierModels.map(row)}
            {showAllTier && otherTierModels.map(row)}
          </div>
          {otherTierModels.length > 0 && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowAllTier((shown) => !shown); }}
              >
                <Icon
                  icon={showAllTier ? "ph:caret-down" : "ph:plus"}
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                {showAllTier
                  ? "Show fewer"
                  : `Show all ${String(tierModels.length)} ${TIER_LABEL[tier].toLowerCase()} variants`}
              </Button>
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <ProviderMark engine="parakeet" className="h-5 w-5" />
            <div>
              <h2 className="font-display text-lg font-medium text-text">Parakeet by NVIDIA</h2>
              <p className="mt-0.5 text-xs text-text-muted">Fast multilingual models tuned for local dictation.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">{parakeetModels.map(row)}</div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-medium text-text">Whisper helper</h2>
              <p className="mt-0.5 text-xs text-text-muted">Required once for every Whisper model.</p>
            </div>
          </div>
          <Card>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">
                  {runtimeDone
                    ? "Installed and ready"
                    : runtimeDownloading
                      ? "Installing the local Whisper helper"
                      : runtime.state === "error"
                        ? (runtime.message ?? "The helper install failed")
                        : "Not installed yet"}
                </p>
                {runtimeDownloading && runtimeProgress !== null && (
                  <ProgressBar value={runtimeProgress} tone="accent" className="mt-2" label="Installing helper" />
                )}
              </div>
              {runtimeDone ? (
                <Badge tone="neutral" icon="ph:check-circle">On this PC</Badge>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={runtimeDownloading}
                  onClick={() => { void api.models.installRuntime().then(refresh); }}
                >
                  <Icon
                    icon={runtimeDownloading ? "ph:circle-notch" : "ph:download-simple"}
                    className={`h-3.5 w-3.5 ${runtimeDownloading ? "motion-safe:animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {runtimeDownloading ? "Installing" : "Install helper"}
                </Button>
              )}
            </div>
          </Card>
        </section>

        <p className="flex items-center gap-1.5 text-xs text-text-muted" data-numeric>
          <Icon icon="ph:hard-drive" className="h-4 w-4" aria-hidden="true" />
          {formatBytes(diskUsed)} used by local models
        </p>
      </div>

      <Dialog
        open={specsOpen}
        onOpenChange={setSpecsOpen}
        title="This PC"
        description="Hardware Struq uses to rank local models."
        size="lg"
        footer={<Button variant="secondary" size="md" onClick={() => { setSpecsOpen(false); }}>Done</Button>}
      >
        {hardware === null ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-sunken p-4">
            <Icon icon="ph:circle-notch" className="h-5 w-5 motion-safe:animate-spin text-accent" aria-hidden="true" />
            <p className="text-sm text-text-secondary">Reading hardware details...</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Card className="flex items-start gap-3">
              <Icon icon="ph:cpu" className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-muted">Processor</p>
                <p className="mt-1 text-sm font-medium leading-snug text-text">{hardware.cpuModel}</p>
                <p className="mt-1 text-xs text-text-secondary" data-numeric>{String(hardware.cpuCores)} logical cores</p>
              </div>
            </Card>
            <Card className="flex items-start gap-3">
              <Icon icon="ph:memory" className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-text-muted">Memory</p>
                <p className="mt-1 text-lg font-medium text-text" data-numeric>{String(hardware.totalMemGb)} GB RAM</p>
                <p className="mt-1 text-xs text-text-secondary">Available to Windows and local models</p>
              </div>
            </Card>
            <Card className="flex items-start gap-3">
              <Icon icon="ph:graphics-card" className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-muted">Graphics</p>
                <p className="mt-1 text-sm font-medium leading-snug text-text">
                  {hardware.gpuName ?? `${hardware.gpuVendor.toUpperCase()} graphics`}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  {hardware.cudaRuntime ? "CUDA acceleration ready" : "CPU path available"}
                </p>
              </div>
            </Card>
            <Card className="flex items-start gap-3 border-accent">
              <Icon icon="ph:gauge" className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-text-muted">Model profile</p>
                <p className="mt-1 text-lg font-medium text-text">{TIER_NAME[machineTier]}</p>
                <p className="mt-1 text-xs text-text-secondary">Used to build your top three picks</p>
              </div>
            </Card>
          </div>
        )}
      </Dialog>
    </div>
  );
}
