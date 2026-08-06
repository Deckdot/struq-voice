import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { Button } from "./Button";
import { Badge } from "./Badge";
import { ProgressBar } from "./ProgressBar";
import { formatBytes } from "./ProgressBar";
import type { ModelStatus } from "../../../../shared/models";
import { cn } from "../../lib/cn";

/**
 * A single model in the catalog. The grid is stable: the action slot on
 * the right is always the same width, so the row never shifts when a
 * download starts or finishes. Status, size and speed align across rows
 * for easy scanning.
 */
export type SpeedLabel = "Fast" | "Balanced" | "High accuracy";

export interface ModelRowProps {
  readonly status: ModelStatus;
  readonly active: boolean;
  readonly measuredRtf?: number;
  readonly speedLabel: SpeedLabel;
  readonly onDownload: () => void;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onRemove: () => void;
  readonly onSelect: () => void;
  readonly onImport: () => void;
}

const isDownloading = (status: ModelStatus): boolean =>
  status.download.state === "downloading";
const isVerifying = (status: ModelStatus): boolean =>
  status.download.state === "verifying";
const isError = (status: ModelStatus): boolean => status.download.state === "error";
const downloadProgress = (status: ModelStatus): number | null => {
  if (status.download.state !== "downloading") return null;
  const { receivedBytes, totalBytes } = status.download;
  if (totalBytes <= 0) return null;
  return Math.min(1, Math.max(0, receivedBytes / totalBytes));
};

export function ModelRow({
  status,
  active,
  measuredRtf,
  speedLabel,
  onDownload,
  onCancel,
  onRetry,
  onRemove,
  onSelect,
  onImport
}: ModelRowProps): JSX.Element {
  const downloading = isDownloading(status);
  const verifying = isVerifying(status);
  const errored = isError(status);
  const installed = status.installed;
  const progress = downloadProgress(status);
  const downloadError = errored && status.download.state === "error" ? status.download.message : null;

  return (
    <article
      className={cn(
        "relative flex items-center gap-3 overflow-hidden rounded-md border bg-surface px-4 py-3",
        "transition-colors duration-hover",
        active ? "border-l-2 border-l-accent border-border" : "border-border"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-medium text-text">{status.model.name}</h3>
          {active && <Badge tone="accent">In use</Badge>}
        </div>
        <p className="mt-0.5 truncate text-xs text-text-muted">{status.model.whenToUse}</p>
      </div>

      <div className="hidden w-[90px] shrink-0 text-right text-xs tabular-nums text-text-secondary md:block" data-numeric>
        {formatBytes(status.model.bytes)}
      </div>

      <div className="hidden w-[140px] shrink-0 truncate text-xs text-text-muted lg:block" title={status.model.languages}>
        {status.model.languages}
      </div>

      <div className="hidden w-[120px] shrink-0 text-xs text-text-muted md:block">
        {measuredRtf !== undefined ? (
          <span className="tabular-nums" data-numeric>
            {measuredRtf.toFixed(2)}x speed
          </span>
        ) : (
          speedLabel
        )}
      </div>

      <div className="w-[160px] shrink-0">
        {downloading && progress !== null ? (
          <div className="flex flex-col gap-1">
            <ProgressBar value={progress} tone="ember" />
            <span className="text-2xs text-text-muted tabular-nums" data-numeric>
              {Math.round(progress * 100)}% downloaded
            </span>
          </div>
        ) : verifying ? (
          <Badge tone="info" icon="ph:circle-notch">
            Verifying
          </Badge>
        ) : downloadError !== null ? (
          <Badge tone="danger">{downloadError}</Badge>
        ) : installed ? (
          <Badge tone="success" icon="ph:check-circle">
            Installed
          </Badge>
        ) : (
          <Badge tone="neutral">Not installed</Badge>
        )}
      </div>

      <div className="flex w-[200px] shrink-0 items-center justify-end gap-2">
        {downloading || verifying ? (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : downloadError !== null ? (
          <Button variant="primary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : installed ? (
          active ? (
            <Button variant="ghost" size="sm" onClick={onRemove}>
              Remove
            </Button>
          ) : (
            <>
              <Button variant="primary" size="sm" onClick={onSelect}>
                Use
              </Button>
              <Button variant="ghost" size="sm" onClick={onRemove}>
                Remove
              </Button>
            </>
          )
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onImport} aria-label="Import from a folder">
              <Icon icon="ph:folder-open" className="h-3.5 w-3.5" aria-hidden="true" />
              Import
            </Button>
            <Button variant="secondary" size="sm" onClick={onDownload}>
              <Icon icon="ph:download-simple" className="h-3.5 w-3.5" aria-hidden="true" />
              Download
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
