import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Download, Check, Trash2, Loader2, HardDrive, FolderOpen } from "lucide-react";
import type { MainWindowApi } from "../../../shared/api";
import type { ModelsListResult, OnboardingProfileResult } from "../../../shared/ipc";
import type { ModelStatus, WhisperTier } from "../../../shared/models";
import { WHISPER_TIER_ORDER, findModel, whisperVariant } from "../../../shared/models";
import { Badge, Button, Card, formatBytes } from "../components/ui";

/**
 * The Models view: the one model this machine should run, then the full
 * catalog for anyone who wants to choose. A list of thirty-one entries with
 * no default is a decision handed to someone with no basis for making it.
 *
 * "Measured on this machine" speed figures land once an engine has run;
 * until then a card shows the catalog's one-liner.
 */

const formatPercent = (received: number, total: number): string =>
  total > 0 ? `${String(Math.round((received / total) * 100))}%` : "0%";

/** Size filter across the whisper tiers. Parakeet models always show. */
type TierFilter = WhisperTier | "all";

const TIER_LABEL: Record<TierFilter, string> = {
  all: "All sizes",
  tiny: "Tiny",
  base: "Base",
  small: "Small",
  medium: "Medium",
  large: "Large"
};

/**
 * Order: parakeet first (the default engine), then whisper smallest tier to
 * largest, and inside a tier the smallest download first. Quantised builds
 * sort ahead of the full-precision weights because they are what most people
 * should take.
 */
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
  const [diskUsed, setDiskUsed] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<ModelsListResult["whisperRuntime"]>({ state: "idle" });
  const [measuredRtf, setMeasuredRtf] = useState<Record<string, number>>({});
  const [tier, setTier] = useState<TierFilter>("all");
  const [englishOnly, setEnglishOnly] = useState(false);
  const [profile, setProfile] = useState<OnboardingProfileResult | null>(null);

  const visible = useMemo(() => {
    const filtered = statuses.filter((status) => {
      const variant = whisperVariant(status.model.id);
      // Tier and English-only are whisper distinctions, so a non-whisper model
      // (parakeet) only belongs in the unfiltered list.
      if (variant === null) return tier === "all" && !englishOnly;
      if (tier !== "all" && variant.tier !== tier) return false;
      if (englishOnly && !variant.englishOnly) return false;
      return true;
    });
    return sortModels(filtered);
  }, [statuses, tier, englishOnly]);

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
    let cancelled = false;
    const initialRefresh = (): void => {
      void api.models.list().then(({ items, totalDiskUsed, whisperRuntime }) => {
        if (!cancelled) {
          setStatuses(items);
          setDiskUsed(totalDiskUsed);
          setRuntime(whisperRuntime);
        }
      });
      void api.metrics.measuredRtf().then(({ byEngine }) => {
        if (!cancelled) setMeasuredRtf(byEngine);
      });
    };
    initialRefresh();
    void api.onboarding.profile().then((result) => {
      if (!cancelled) setProfile(result);
    });
    const unsubscribe = api.models.onDownloadProgress(() => {
      refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  const runtimeDownloading = runtime.state === "downloading";
  const runtimeDone = runtime.state === "done";
  const runtimeError = runtime.state === "error";

  const recommended = profile?.recommendation ?? null;
  const recommendedModel = recommended === null ? null : findModel(recommended.modelId);
  const recommendedStatus =
    recommended === null
      ? undefined
      : statuses.find((status) => status.model.id === recommended.modelId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-serif text-2xl tracking-tight text-text">Models</h1>
        <p className="mt-1 text-sm text-text-muted">
          Local engines, downloaded to your machine. OpenRouter is the zero-setup
          cloud path and never appears here.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex max-w-2xl flex-col gap-8">
          {recommendedModel !== null && recommended !== null && (
            <section>
              <h2 className="text-base font-semibold text-text">Recommended for this PC</h2>
              <p className="mt-0.5 text-sm text-text-muted">{recommended.reason}</p>
              <Card className="mt-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-text">{recommendedModel.name}</h3>
                    <p className="mt-0.5 text-sm text-text-muted">{recommendedModel.whenToUse}</p>
                    <p className="mt-1 text-2xs uppercase tracking-wide text-text-muted">
                      {recommendedModel.languages} &middot; {formatBytes(recommendedModel.bytes)}
                    </p>
                  </div>
                  {recommendedStatus?.installed === true ? (
                    <Badge tone="success">
                      <Check className="h-3 w-3" aria-hidden="true" /> Installed
                    </Badge>
                  ) : (
                    <Button
                      variant="primary"
                      size="md"
                      onClick={() => {
                        void api.onboarding.startRecommended().then(refresh);
                      }}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Download and use
                    </Button>
                  )}
                </div>
              </Card>
            </section>
          )}

          <section>
            <h2 className="text-base font-semibold text-text">All models</h2>
            <p className="mt-0.5 text-sm text-text-muted">
              Every build in the catalog. Smaller is faster, larger is more accurate.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {(["all", ...WHISPER_TIER_ORDER] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={tier === option}
                  onClick={() => {
                    setTier(option);
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors duration-fast ${
                    tier === option
                      ? "border-accent bg-accent-soft text-accent-text"
                      : "border-border text-text-muted hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  {TIER_LABEL[option]}
                </button>
              ))}
              <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={englishOnly}
                  onChange={(event) => {
                    setEnglishOnly(event.target.checked);
                  }}
                  className="accent-[var(--color-accent)]"
                />
                English-only builds
              </label>
              <span className="ml-auto text-xs text-text-muted" data-numeric>
                {String(visible.length)} of {String(statuses.length)}
              </span>
            </div>
          </section>

          <div className="flex flex-col gap-3">
            {visible.map((status) => {
            const downloading = status.download.state === "downloading";
            const verifying = status.download.state === "verifying";
            const done = status.installed;
            const error = status.download.state === "error";
            const progress =
              status.download.state === "downloading"
                ? formatPercent(status.download.receivedBytes, status.download.totalBytes)
                : null;
            const measured = measuredRtf[status.model.engine];
            return (
              <Card key={status.model.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-text">{status.model.name}</h3>
                    <p className="mt-0.5 text-sm text-text-muted">{status.model.whenToUse}</p>
                    <p className="mt-1 text-2xs uppercase tracking-wide text-text-muted">
                      {status.model.languages} &middot; {formatBytes(status.model.bytes)}
                      {measured !== undefined && (
                        <>
                          {" "}&middot; measured RTF {measured.toFixed(2)}x
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {done && (
                      <Badge tone="success">
                        <Check className="h-3 w-3" aria-hidden="true" /> Installed
                      </Badge>
                    )}
                    {downloading && (
                      <Badge tone="accent">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        {progress}
                      </Badge>
                    )}
                    {verifying && (
                      <Badge tone="accent">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Verifying
                      </Badge>
                    )}
                    {error && status.download.state === "error" && (
                      <Badge tone="danger">{status.download.message}</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-text-muted">
                    {status.installed
                      ? `${formatBytes(status.installedBytes)} on disk`
                      : "Not installed"}
                  </span>
                  {done ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        void api.models.remove({ modelId: status.model.id }).then(refresh);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                    </Button>
                  ) : downloading || verifying ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void api.models.cancel({ modelId: status.model.id }).then(refresh);
                      }}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void api.models.import({ modelId: status.model.id }).then(refresh);
                        }}
                      >
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> Import folder
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          void api.models.download({ modelId: status.model.id }).then(refresh);
                        }}
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
            })}
          </div>

          {/* Infrastructure rather than a choice, so it sits after the models
              it exists to serve. */}
          <section>
            <h2 className="text-base font-semibold text-text">Whisper runtime</h2>
            <p className="mt-0.5 text-sm text-text-muted">
              whisper-cli.exe, required by the Whisper.cpp models. CPU build, around 8MB.
              Installs itself on first run; the button is for when that failed.
            </p>
            <Card className="mt-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-text-muted">
                  {runtimeDone
                    ? "Installed and ready."
                    : runtimeDownloading
                      ? `Downloading, ${
                          runtime.totalBytes !== undefined
                            ? formatPercent(runtime.receivedBytes ?? 0, runtime.totalBytes)
                            : "starting"
                        }`
                      : runtimeError
                        ? runtime.message ?? "The download failed."
                        : "Not installed."}
                </span>
                {runtimeDone ? (
                  <Badge tone="success">
                    <Check className="h-3 w-3" aria-hidden="true" /> Ready
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
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {runtimeDownloading ? "Downloading" : "Install runtime"}
                  </Button>
                )}
              </div>
            </Card>
          </section>

          <p className="flex items-center gap-1.5 text-xs text-text-muted" data-numeric>
            <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
            {formatBytes(diskUsed ?? 0)} used by models
          </p>
        </div>
      </div>
    </div>
  );
}
