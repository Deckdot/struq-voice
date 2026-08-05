import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Download, Check, Trash2, Loader2, HardDrive, FolderOpen } from "lucide-react";
import type { MainWindowApi } from "../../../shared/api";
import type { ModelsListResult } from "../../../shared/ipc";
import type { ModelStatus } from "../../../shared/models";

/**
 * The Models view: a card per catalog model with install state, live
 * download progress and per-model delete. "Measured on this machine" speed
 * figures land once an engine has run; until then the card shows the
 * catalog's one-liner.
 */

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatPercent = (received: number, total: number): string =>
  total > 0 ? `${String(Math.round((received / total) * 100))}%` : "0%";

export function ModelsView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [statuses, setStatuses] = useState<readonly ModelStatus[]>([]);
  const [diskUsed, setDiskUsed] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<ModelsListResult["whisperRuntime"]>({ state: "idle" });

  const refresh = (): void => {
    void api.models.list().then(({ items, totalDiskUsed, whisperRuntime }) => {
      setStatuses(items);
      setDiskUsed(totalDiskUsed);
      setRuntime(whisperRuntime);
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
    };
    initialRefresh();
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
        <div className="flex max-w-2xl flex-col gap-3">
          <article className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-medium text-text">Whisper runtime</h2>
                <p className="mt-0.5 text-sm text-text-muted">
                  whisper-cli.exe, required for the Whisper.cpp models. CPU build, ~8MB.
                </p>
              </div>
              {runtimeDone && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">
                  <Check className="h-3 w-3" aria-hidden="true" /> Installed
                </span>
              )}
              {runtimeDownloading && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-text">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  {runtime.totalBytes !== undefined
                    ? formatPercent(runtime.receivedBytes ?? 0, runtime.totalBytes)
                    : "..."}
                </span>
              )}
              {runtimeError && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger">
                  {runtime.message}
                </span>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              {runtimeDone ? (
                <span className="text-xs text-text-muted">Ready</span>
              ) : runtimeDownloading ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Downloading
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void api.models.installRuntime().then(refresh);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent-solid px-3 py-1.5 text-xs font-medium text-text-inverse transition-colors duration-fast hover:bg-accent-solid-hover"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Install runtime
                </button>
              )}
            </div>
          </article>

          {statuses.map((status) => {
            const downloading = status.download.state === "downloading";
            const verifying = status.download.state === "verifying";
            const done = status.installed;
            const error = status.download.state === "error";
            const progress =
              status.download.state === "downloading"
                ? formatPercent(status.download.receivedBytes, status.download.totalBytes)
                : null;
            return (
              <article
                key={status.model.id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-medium text-text">{status.model.name}</h2>
                    <p className="mt-0.5 text-sm text-text-muted">{status.model.whenToUse}</p>
                    <p className="mt-1 text-2xs uppercase tracking-wide text-text-muted">
                      {status.model.languages} &middot; {formatBytes(status.model.bytes)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {done && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">
                        <Check className="h-3 w-3" aria-hidden="true" /> Installed
                      </span>
                    )}
                    {downloading && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-text">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        {progress}
                      </span>
                    )}
                    {verifying && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-text">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Verifying
                      </span>
                    )}
                    {error && status.download.state === "error" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger">
                        {status.download.message}
                      </span>
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
                    <button
                      type="button"
                      onClick={() => {
                        void api.models.remove({ modelId: status.model.id }).then(refresh);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted transition-colors duration-fast hover:border-danger-soft hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                    </button>
                  ) : downloading || verifying ? (
                    <button
                      type="button"
                      onClick={() => {
                        void api.models.cancel({ modelId: status.model.id }).then(refresh);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted transition-colors duration-fast hover:bg-surface-hover hover:text-text"
                    >
                      Cancel
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void api.models.import({ modelId: status.model.id }).then(refresh);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors duration-fast hover:bg-surface-hover hover:text-text"
                      >
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> Import folder
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void api.models.download({ modelId: status.model.id }).then(refresh);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-accent-solid px-3 py-1.5 text-xs font-medium text-text-inverse transition-colors duration-fast hover:bg-accent-solid-hover"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-6 flex items-center gap-1.5 text-xs text-text-muted">
          <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
          {formatBytes(diskUsed ?? 0)} used by models
        </p>
      </div>
    </div>
  );
}
