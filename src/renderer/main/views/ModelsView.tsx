import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import type { HardwareProfile, MachineTier } from "../../../shared/hardware";
import { cleanCpuModel, normalizeMemGb, recommendModel } from "../../../shared/hardware";
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
import { useTranslation } from "../lib/useTranslation";

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
const formatVariantLabel = (fileName: string): string =>
  fileName
    .replace(/^ggml-/, "")
    .replace(/\.bin$/, "")
    .replace(/-q[58]_[01]$/, "")
    .replace(/\.en$/, "");

const humanModelName = (status: ModelStatus): string => {
  if (status.model.engine === "parakeet") {
    if (status.model.id.includes("v3")) return "Parakeet TDT v3";
    if (status.model.id.includes("v2")) return "Parakeet TDT v2";
    return "Parakeet";
  }
  const variant = whisperVariant(status.model.id);
  if (variant === null) return status.model.name;
  const base = formatVariantLabel(variant.fileName);
  const englishNote = variant.englishOnly ? " · English only" : "";
  return `Whisper ${base}${englishNote}`;
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
  const { t } = useTranslation();
  const progress = progressFor(status);
  const downloading = status.download.state === "downloading";
  const verifying = status.download.state === "verifying";
  const errored = status.download.state === "error";

  return (
    <Card
      className="flex min-h-[180px] flex-col gap-4 border-border hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <ProviderMark engine={status.model.engine} className="h-7 w-7" />
        <Badge tone="neutral">{label}</Badge>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-normal leading-snug text-text">
          {humanModelName(status)}
        </h3>
        <p className="mt-2 text-xs text-text-muted" data-numeric>
          {formatBytes(status.model.bytes)} · {status.model.languages}
        </p>
      </div>
      {downloading && progress !== null && (
        <ProgressBar value={progress} tone="accent" label={t("models.card.downloading")} />
      )}
      <div className="flex min-h-8 items-center justify-end gap-2">
        {downloading || verifying ? (
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={verifying}>
            {verifying ? t("models.card.verifying") : t("models.card.cancel")}
          </Button>
        ) : errored ? (
          <Button variant="primary" size="sm" onClick={onRetry}>{t("models.card.retry")}</Button>
        ) : status.installed ? (
          active ? (
            <Button variant="ghost" size="sm" disabled>{t("models.card.active")}</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={onSelect}>{t("models.card.useModel")}</Button>
          )
        ) : (
          <Button variant="primary" size="sm" onClick={onDownload}>
            <Icon icon="ph:download-simple" className="h-3.5 w-3.5" aria-hidden="true" />
            {t("models.card.download")}
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
  const [gpu, setGpu] = useState<{
    supported: boolean;
    bytes: number;
    install: {
      state: "idle" | "downloading" | "done" | "error";
      receivedBytes?: number;
      totalBytes?: number;
      message?: string;
    };
  }>({ supported: false, bytes: 0, install: { state: "idle" } });
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
    fallback: string | null;
    whisperModelId: string;
    parakeetModelId: string;
  } | null>(null);
  const [specsOpen, setSpecsOpen] = useState(false);

  const refresh = (): void => {
    void api.models.list().then(({ items, totalDiskUsed, whisperRuntime, whisperGpu }) => {
      setStatuses(items);
      setDiskUsed(totalDiskUsed);
      setRuntime(whisperRuntime);
      setGpu(whisperGpu);
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
        fallback: settings.engine.fallback,
        whisperModelId: settings.whisperModelId,
        parakeetModelId: settings.parakeetModelId
      });
    });
    return api.settings.onChange((settings) => {
      setActiveSelection({
        primary: settings.engine.primary,
        fallback: settings.engine.fallback,
        whisperModelId: settings.whisperModelId,
        parakeetModelId: settings.parakeetModelId
      });
    });
  }, [api]);

  useEffect(() => {
    refresh();
    return api.models.onDownloadProgress((event) => {
      // A progress tick changes one row's byte counter and nothing else, so
      // update that row in place. Re-listing the whole catalog per tick meant
      // an IPC round trip and a full re-render several times a second.
      if (event.state === "downloading") {
        setStatuses((current) =>
          current.map((status) =>
            status.model.id === event.modelId
              ? {
                  ...status,
                  download: {
                    state: "downloading",
                    receivedBytes: event.receivedBytes,
                    totalBytes: event.totalBytes
                  }
                }
              : status
          )
        );
        return;
      }
      // Terminal states change installed flags and disk usage, which only
      // main can answer for.
      refresh();
    });
  }, [api]);

  /**
   * The accent "Active" badge is reserved for the model actually running:
   * selected AND installed. A selection without files on disk must never
   * claim to be active, or a failed download would contradict its own page.
   */
  const isModelActive = (status: ModelStatus): boolean =>
    status.installed && isModelSelected(status);

  /**
   * Matches the settings selection, whether or not the files exist. Used for
   * the "selected but not downloaded" card, which owns the warning instead of
   * a fake Active badge. Parakeet rows match on the exact catalog id the
   * engine loads, so v2 and v3 cannot both claim the selection.
   */
  const isModelSelected = (status: ModelStatus): boolean => {
    if (activeSelection === null) return false;
    if (status.model.engine === "parakeet") {
      return (
        activeSelection.primary === "parakeet" &&
        status.model.id === activeSelection.parakeetModelId
      );
    }
    return (
      activeSelection.primary === "whisper-cpp" &&
      activeSelection.whisperModelId === status.model.id
    );
  };

  /**
   * Picking a model changes which engine runs and which model it loads, and
   * nothing else.
   *
   * Both branches used to send `fallback: null`, so choosing a model
   * silently cleared the backup service. That field is also the only opt-in
   * permitting a local engine to cascade to the cloud, so a model pick
   * revoked a consent the user gave elsewhere and dictation stopped falling
   * back with no visible cause.
   */
  const selectModel = (status: ModelStatus): void => {
    const fallback = activeSelection?.fallback ?? null;
    if (status.model.engine === "parakeet") {
      // Only the engine and the Parakeet id move. Blanking whisperModelId
      // here used to fail the schema's min(1) and reset the whole profile,
      // and it threw away the Whisper model to come back to anyway.
      void api.settings.update({
        engine: { primary: "parakeet", fallback },
        parakeetModelId: status.model.id
      });
      return;
    }
    void api.settings.update({
      engine: { primary: "whisper-cpp", fallback },
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
  // A selection whose files are missing renders as "selected, not
  // downloaded" with a download path, never as Active.
  const selectedStatus = currentStatus ?? statuses.find(isModelSelected);
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
  const otherTierModels = tierModels.slice(3);
  const parakeetModels = statuses.filter((status) => status.model.engine === "parakeet");

  const runtimeDownloading = runtime.state === "downloading";
  const runtimeDone = runtime.state === "done";
  const runtimeProgress =
    runtimeDownloading && runtime.totalBytes !== undefined && runtime.totalBytes > 0
      ? Math.min(1, Math.max(0, (runtime.receivedBytes ?? 0) / runtime.totalBytes))
      : null;

  const gpuDownloading = gpu.install.state === "downloading";
  const gpuDone = gpu.install.state === "done";
  const gpuProgress =
    gpuDownloading && gpu.install.totalBytes !== undefined && gpu.install.totalBytes > 0
      ? Math.min(1, Math.max(0, (gpu.install.receivedBytes ?? 0) / gpu.install.totalBytes))
      : null;

  const { t } = useTranslation();

  const tierName: Record<MachineTier, string> = {
    light: t("models.tierName.light"),
    balanced: t("models.tierName.balanced"),
    performance: t("models.tierName.performance")
  };

  return (
    <div className="h-full overflow-y-auto bg-bg" data-selectable>
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 py-5">
        {/* Honest callout for light machines */}
        {machineTier === "light" && (
          <Card className="border-warning bg-warning-soft">
            <div className="flex items-start gap-3">
              <Icon icon="ph:warning-circle" className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="text-sm font-normal text-text">{t("models.lightPcWarning.title")}</p>
                <p className="mt-1 text-xs text-text-muted">
                  {t("models.lightPcWarning.body")}
                </p>
              </div>
            </div>
          </Card>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between gap-4">
            <h2 className="font-display text-lg font-normal text-text">{t("models.activeModel.title")}</h2>
          </div>
          <Card>
            {selectedStatus === undefined ? (
              <div className="flex items-center gap-3">
                <Icon icon="ph:cloud" className="h-6 w-6 text-text-muted" aria-hidden="true" />
                <div>
                  <p className="text-sm font-normal text-text">{t("models.activeModel.noneTitle")}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t("models.activeModel.noneBody")}
                  </p>
                </div>
              </div>
            ) : currentStatus !== undefined ? (
              <div className="flex items-center gap-4">
                <ProviderMark engine={currentStatus.model.engine} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-base font-normal text-text">
                      {humanModelName(currentStatus)}
                    </p>
                    <Badge tone="accent">{t("models.activeModel.badge")}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-text-muted" data-numeric>
                    {currentStatus.model.languages} · {formatBytes(currentStatus.model.bytes)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <ProviderMark engine={selectedStatus.model.engine} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-base font-normal text-text">
                      {humanModelName(selectedStatus)}
                    </p>
                    <Badge tone="warning">{t("models.activeModel.selectedBadge")}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {t("models.activeModel.notDownloaded")}
                  </p>
                </div>
                {selectedStatus.download.state === "downloading" ||
                selectedStatus.download.state === "verifying" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void api.models.cancel({ modelId: selectedStatus.model.id }).then(refresh);
                    }}
                  >
                    {t("models.card.cancel")}
                  </Button>
                ) : selectedStatus.download.state === "error" ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      void api.models.download({ modelId: selectedStatus.model.id }).then(refresh);
                    }}
                  >
                    {t("models.card.retry")}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      void api.models.download({ modelId: selectedStatus.model.id }).then(refresh);
                    }}
                  >
                    {t("models.card.download")}
                  </Button>
                )}
              </div>
            )}
          </Card>
        </section>

        <section>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-normal text-text">{t("models.recommended.title")}</h2>
                <Badge tone="neutral">{tierName[machineTier]}</Badge>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {hardware !== null
                  ? recommendModel(hardware).reason
                  : (recommendation?.reason ?? t("models.recommended.reading"))}
              </p>
            </div>
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => { setSpecsOpen(true); }}>
              <Icon icon="ph:desktop-tower" className="h-3.5 w-3.5" aria-hidden="true" />
              {t("models.recommended.specsBtn")}
            </Button>
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

        {/* Catalog Tiers */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-normal text-text">{t("models.whisper.title")}</h2>
              <p className="mt-0.5 text-xs text-text-muted">
                {TIER_GUIDANCE[tier]}
              </p>
            </div>
            <SegmentedControl<WhisperTier>
              options={WHISPER_TIER_ORDER.map((value) => ({
                value,
                label: TIER_LABEL[value]
              }))}
              value={tier}
              onChange={(next) => {
                setTier(next);
                setShowAllTier(false);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
                {t("models.whisper.lightest")}
              </span>
            </div>
            {lightestTierModels.map(row)}

            {otherTierModels.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                {!showAllTier ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-center text-xs text-text-muted hover:text-text"
                    onClick={() => { setShowAllTier(true); }}
                  >
                    {t("models.whisper.showAll", { count: tierModels.length, tier: TIER_LABEL[tier].toLowerCase() })}
                  </Button>
                ) : (
                  <>
                    <div className="mb-1 flex items-center justify-between pt-2">
                      <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
                        {t("models.whisper.allVariants", { tier: TIER_LABEL[tier].toLowerCase() })}
                      </span>
                    </div>
                    {tierModels.map(row)}
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Parakeet section */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <ProviderMark engine="parakeet" className="h-5 w-5" />
            <div>
              <h2 className="font-display text-lg font-normal text-text">{t("models.parakeet.title")}</h2>
              <p className="mt-0.5 text-xs text-text-muted">{t("models.parakeet.subtitle")}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">{parakeetModels.map(row)}</div>
        </section>

        {!runtimeDone && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-normal text-text">{t("models.helper.title")}</h2>
                <p className="mt-0.5 text-xs text-text-muted">{t("models.helper.subtitle")}</p>
              </div>
            </div>
            <Card>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-normal text-text">
                    {runtimeDownloading
                      ? t("models.helper.installing")
                      : runtime.state === "error"
                        ? (runtime.message ?? t("models.helper.failed"))
                        : t("models.helper.notInstalled")}
                  </p>
                  {runtimeDownloading && runtimeProgress !== null && (
                    <ProgressBar value={runtimeProgress} tone="accent" className="mt-2" label={t("models.helper.installing")} />
                  )}
                </div>
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
                  {runtimeDownloading ? t("models.helper.installingBtn") : t("models.helper.installBtn")}
                </Button>
              </div>
            </Card>
          </section>
        )}

        {/*
          Offered only on an NVIDIA machine, because the CUDA build changes
          nothing anywhere else and it is a 670MB download. Whisper decodes on
          the GPU as soon as it is installed; nothing else has to be chosen.
        */}
        {gpu.supported && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Icon icon="ph:graphics-card" className="h-5 w-5 text-text-muted" aria-hidden="true" />
              <div>
                <h2 className="font-display text-lg font-normal text-text">{t("models.gpu.title")}</h2>
                <p className="mt-0.5 text-xs text-text-muted">{t("models.gpu.subtitle")}</p>
              </div>
            </div>
            <Card>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-normal text-text">
                    {gpuDone
                      ? t("models.gpu.ready")
                      : gpuDownloading
                        ? t("models.gpu.installing")
                        : gpu.install.state === "error"
                          ? (gpu.install.message ?? t("models.gpu.failed"))
                          : t("models.gpu.notInstalled", { size: formatBytes(gpu.bytes) })}
                  </p>
                  {gpuDownloading && gpuProgress !== null && (
                    <ProgressBar
                      value={gpuProgress}
                      tone="accent"
                      className="mt-2"
                      label={t("models.gpu.installing")}
                    />
                  )}
                </div>
                {gpuDone ? (
                  <Icon
                    icon="ph:check-circle"
                    className="h-5 w-5 shrink-0 text-accent"
                    aria-hidden="true"
                  />
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={gpuDownloading}
                    onClick={() => { void api.models.installGpuRuntime().then(refresh); }}
                  >
                    <Icon
                      icon={gpuDownloading ? "ph:circle-notch" : "ph:download-simple"}
                      className={`h-3.5 w-3.5 ${gpuDownloading ? "motion-safe:animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    {gpuDownloading ? t("models.gpu.installingBtn") : t("models.gpu.installBtn")}
                  </Button>
                )}
              </div>
            </Card>
          </section>
        )}

        <p className="flex items-center gap-1.5 text-xs text-text-muted" data-numeric>
          <Icon icon="ph:hard-drive" className="h-4 w-4" aria-hidden="true" />
          {t("models.diskUsed", { size: formatBytes(diskUsed) })}
        </p>
      </div>

      <Dialog
        open={specsOpen}
        onOpenChange={setSpecsOpen}
        title={t("models.specsDialog.title")}
        description={t("models.specsDialog.description")}
        size="lg"
        footer={
          <Button variant="secondary" size="md" onClick={() => { setSpecsOpen(false); }}>
            {t("models.specsDialog.done")}
          </Button>
        }
      >
        {hardware === null ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-sunken p-4">
            <Icon icon="ph:circle-notch" className="h-5 w-5 motion-safe:animate-spin text-accent" aria-hidden="true" />
            <p className="text-sm text-text-secondary">{t("models.specsDialog.reading")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Summary Banner */}
            <div className="flex items-center justify-between rounded-md border border-border bg-surface-hover/50 p-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface text-accent shadow-xs">
                  <Icon icon="ph:desktop-tower" className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-text">
                      {cleanCpuModel(hardware.cpuModel) || t("models.specsDialog.systemHardware")}
                    </p>
                    <Badge tone="accent">{tierName[machineTier]}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted" data-numeric>
                    {hardware.gpuName ?? t("models.specsDialog.gpuDefault")} · {String(hardware.cpuCores)} cores · {String(normalizeMemGb(hardware.totalMemGb))} GB RAM
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Card className="flex items-start gap-3">
                <Icon icon="ph:cpu" className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-text-muted">{t("models.specsDialog.cpu")}</p>
                  <p className="mt-1 text-sm font-medium leading-snug text-text">
                    {cleanCpuModel(hardware.cpuModel) || hardware.cpuModel}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary" data-numeric>
                    {t("models.specsDialog.cpuCores", { cores: hardware.cpuCores })}
                  </p>
                </div>
              </Card>

              <Card className="flex items-start gap-3">
                <Icon icon="ph:graphics-card" className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-text-muted">{t("models.specsDialog.gpu")}</p>
                  <p className="mt-1 text-sm font-medium leading-snug text-text">
                    {hardware.gpuName ?? (hardware.gpuVendor !== "unknown" ? `${hardware.gpuVendor.toUpperCase()} graphics` : "Standard GPU")}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {hardware.cudaRuntime ? t("models.specsDialog.gpuCuda") : t("models.specsDialog.gpuCpuPath")}
                  </p>
                </div>
              </Card>

              <Card className="flex items-start gap-3">
                <Icon icon="ph:memory" className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-text-muted">{t("models.specsDialog.ram")}</p>
                  <p className="mt-1 text-base font-medium text-text" data-numeric>
                    {String(normalizeMemGb(hardware.totalMemGb))} GB RAM
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {t("models.specsDialog.ramAllocated")}
                  </p>
                </div>
              </Card>

              <Card className="flex items-start gap-3 border-accent/40 bg-accent-soft/10">
                <Icon icon="ph:gauge" className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-text-muted">{t("models.specsDialog.profile")}</p>
                  <p className="mt-1 text-base font-medium text-text">
                    {tierName[machineTier]}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {t("models.specsDialog.profileRank")}
                  </p>
                </div>
              </Card>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
