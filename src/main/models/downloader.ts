/**
 * Downloads catalog models into `modelsRoot`. Verified files live at
 * `modelsRoot/<modelId>/<file.path>`; in-progress parts live at
 * `modelsRoot/<modelId>/.partial/<file.path>.part` beside a JSON meta file
 * with the source url, expected hash and bytes received so far. Parts are
 * resumed with HTTP range requests, downloads are capped at three concurrent
 * file transfers across all models, and progress is emitted per model on a
 * 250ms throttle with a single final emit on done or error.
 *
 * Hardening for hostile networks: every attempt runs under a stall watchdog
 * (no bytes for 30s aborts), transient failures (network drop, 5xx, 429,
 * timeout, AV file locks) retry with linear backoff up to three attempts,
 * the final sha256-verified rename retries EPERM/EACCES from scanners, and
 * every failure is classified into a machine-readable code the renderer can
 * translate instead of a raw Error string.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ModelDownloadErrorCode,
  ModelDownloadState,
  ModelFile,
  DownloadBundle
} from "../../shared/models";

const ZERO_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
/**
 * Concurrent transfers across all models. A single connection to the CDN is
 * throttled well below a typical link, so the ceiling here is what determines
 * throughput far more than any per-connection tuning. Six keeps a large model
 * saturating the link without opening an unreasonable number of sockets.
 */
export const MAX_CONCURRENT_FILES = 6;
const PROGRESS_INTERVAL_MS = 250;
/** No bytes for this long aborts the attempt; a proxy that accepts and then
 * stalls must not leave the UI on "downloading" forever. */
const STALL_TIMEOUT_MS = 30_000;
/** Transient failures retry this many times total (first try plus retries). */
const MAX_ATTEMPTS = 3;
/** Backoff between attempts: delay * attemptNumber. */
const RETRY_DELAY_MS = 1_000;
/** A scanner holding a freshly written file fails rename; retry before giving up. */
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 200;
/** Statuses a busy server or a flaky proxy can return that a retry may fix. */
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);

class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

class ChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChecksumError";
  }
}

class StallTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StallTimeoutError";
  }
}

/**
 * Maps any thrown failure onto a machine-readable code and whether another
 * attempt has a chance of succeeding. Codes travel over IPC to the renderer,
 * which translates them; the retryable flag decides the retry loop.
 */
export const classifyDownloadError = (error: unknown): {
  readonly code: ModelDownloadErrorCode;
  readonly retryable: boolean;
} => {
  if (error instanceof ChecksumError) {
    return { code: "checksum", retryable: false };
  }
  if (error instanceof StallTimeoutError) {
    return { code: "timeout", retryable: true };
  }
  if (error instanceof HttpStatusError) {
    return { code: "http", retryable: RETRYABLE_HTTP.has(error.status) };
  }
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (code === "ENOSPC") {
    return { code: "disk", retryable: false };
  }
  if (code === "EACCES" || code === "EPERM" || code === "EBUSY") {
    return { code: "permission", retryable: true };
  }
  return { code: "network", retryable: true };
};

export interface DownloadDeps {
  readonly fetch: typeof fetch;
  readonly emitProgress: (event: {
    modelId: string;
    receivedBytes: number;
    totalBytes: number;
  }) => void;
  /** Tuning knobs for tests; production runs on the defaults above. */
  readonly stallTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

export interface DownloadHandle {
  readonly abort: () => void;
  readonly done: Promise<void>;
}

export interface Downloader {
  start: (model: DownloadBundle) => DownloadHandle;
  cancel: (modelId: string) => void;
  state: (modelId: string) => ModelDownloadState;
}

interface PartMeta {
  url: string;
  expectedSha256: string;
  receivedBytes: number;
}

interface FileProgress {
  installed: boolean;
  current: number;
}

interface Run {
  cancelled: boolean;
  controllers: Set<AbortController>;
  progress: Map<string, FileProgress>;
  lastEmit: number;
  handle?: DownloadHandle;
}

export const createDownloader = (
  modelsRoot: string,
  deps: DownloadDeps
): Downloader => {
  const stallTimeoutMs = deps.stallTimeoutMs ?? STALL_TIMEOUT_MS;
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;
  const retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;
  const states = new Map<string, ModelDownloadState>();
  const runs = new Map<string, Run>();
  const queue: Array<() => void> = [];
  let activeDownloads = 0;

  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  const acquireSlot = async (): Promise<void> => {
    if (activeDownloads < MAX_CONCURRENT_FILES) {
      activeDownloads += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      queue.push(resolve);
    });
  };

  const releaseSlot = (): void => {
    const next = queue.shift();
    if (next !== undefined) {
      next();
      return;
    }
    activeDownloads -= 1;
  };

  const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  const isCancelled = (run: Run): boolean => run.cancelled;

  /**
   * Windows scanners (Defender, corporate EDR) hold freshly written files for
   * inspection. The one-shot rename then throws EPERM even though the bytes
   * are good; a few short retries turn a false failure into a clean install.
   */
  const renameWithRetry = async (from: string, to: string): Promise<void> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(from, to);
        return;
      } catch (error) {
        const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
        if (
          (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") ||
          attempt >= RENAME_ATTEMPTS
        ) {
          throw error;
        }
        await sleep(RENAME_RETRY_DELAY_MS * attempt);
      }
    }
  };

  /** Persist the real on-disk byte count so a later resume range matches. */
  const persistPartMeta = async (
    model: DownloadBundle,
    file: ModelFile,
    metaPath: string,
    partPath: string
  ): Promise<void> => {
    const size = (await stat(partPath).catch(() => null))?.size ?? 0;
    const safeMeta: PartMeta = {
      url: file.url,
      expectedSha256: file.sha256,
      receivedBytes: size
    };
    await writeFile(metaPath, JSON.stringify(safeMeta), "utf8").catch(() => {});
  };

  const hashFile = async (filePath: string): Promise<string> => {
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      createReadStream(filePath)
        .on("data", (chunk: string | Buffer) => {
          hash.update(chunk);
        })
        .on("error", reject)
        .on("end", resolve);
    });
    return hash.digest("hex");
  };

  const installedFile = async (model: DownloadBundle, file: ModelFile): Promise<boolean> => {
    const finalPath = join(modelsRoot, model.id, file.path);
    try {
      await stat(finalPath);
    } catch {
      return false;
    }
    if (file.sha256 === ZERO_HASH) {
      return true;
    }
    return (await hashFile(finalPath)) === file.sha256;
  };

  const partPathFor = (model: DownloadBundle, file: ModelFile): string =>
    join(modelsRoot, model.id, ".partial", `${file.path}.part`);

  const metaPathFor = (model: DownloadBundle, file: ModelFile): string =>
    `${partPathFor(model, file)}.json`;

  const readPartMeta = async (metaPath: string): Promise<PartMeta | null> => {
    try {
      const raw = await readFile(metaPath, "utf8");
      return JSON.parse(raw) as PartMeta;
    } catch {
      return null;
    }
  };

  const receivedBytes = (model: DownloadBundle, run: Run): number => {
    let total = 0;
    for (const file of model.files) {
      const progress = run.progress.get(file.path);
      if (progress !== undefined) {
        total += progress.installed ? file.bytes : progress.current;
      }
    }
    return total;
  };

  const emitThrottled = (model: DownloadBundle, run: Run): void => {
    const now = Date.now();
    if (now - run.lastEmit < PROGRESS_INTERVAL_MS) {
      return;
    }
    run.lastEmit = now;
    deps.emitProgress({
      modelId: model.id,
      receivedBytes: receivedBytes(model, run),
      totalBytes: model.bytes
    });
  };

  const emitFinal = (model: DownloadBundle, run: Run): void => {
    deps.emitProgress({
      modelId: model.id,
      receivedBytes: receivedBytes(model, run),
      totalBytes: model.bytes
    });
  };

  const setDownloading = (model: DownloadBundle, run: Run): void => {
    states.set(model.id, {
      state: "downloading",
      receivedBytes: receivedBytes(model, run),
      totalBytes: model.bytes
    });
    emitThrottled(model, run);
  };

  const streamBody = async (
    response: Response,
    partPath: string,
    mode: "append" | "truncate",
    resumeFrom: number,
    model: DownloadBundle,
    run: Run,
    progress: FileProgress,
    onActivity: () => void
  ): Promise<number> => {
    const body = response.body;
    if (body === null) {
      throw new Error("Empty response body while downloading a file.");
    }
    const reader = body.getReader();
    const stream = createWriteStream(partPath, {
      flags: mode === "append" ? "a" : "w"
    });
    let streamFailure: Error | undefined;
    const streamError = (): Error | undefined => streamFailure;
    stream.on("error", (error: unknown) => {
      streamFailure = error instanceof Error ? error : new Error(String(error));
    });
    let received = resumeFrom;
    progress.current = resumeFrom;
    try {
      for (;;) {
        const failure = streamError();
        if (failure !== undefined) {
          throw failure;
        }
        const read = await reader.read();
        if (read.done) {
          break;
        }
        received += read.value.byteLength;
        const canContinue = stream.write(read.value);
        progress.current = received;
        onActivity();
        emitThrottled(model, run);
        if (!canContinue) {
          // Both listeners must come off whichever way this settles. Leaving
          // the loser attached adds one listener per backpressure pause, which
          // is thousands over a large model and trips the MaxListeners warning.
          await new Promise<void>((resolve) => {
            const done = (): void => {
              stream.off("drain", done);
              stream.off("error", done);
              resolve();
            };
            stream.once("drain", done);
            stream.once("error", done);
          });
        }
      }
      const failure = streamError();
      if (failure !== undefined) {
        throw failure;
      }
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          reject(error);
        };
        stream.once("error", onError);
        stream.end(() => {
          stream.off("error", onError);
          resolve();
        });
      });
      return received;
    } catch (error) {
      stream.destroy();
      throw error;
    }
  };

  const downloadFile = async (
    model: DownloadBundle,
    file: ModelFile,
    run: Run
  ): Promise<"ok" | "aborted" | "failed"> => {
    const known = run.progress.get(file.path);
    if (known !== undefined && known.installed) {
      return "ok";
    }
    if (isCancelled(run)) {
      return "aborted";
    }

    const partPath = partPathFor(model, file);
    const metaPath = metaPathFor(model, file);
    await mkdir(dirname(partPath), { recursive: true });

    let resumeFrom = 0;
    const meta = await readPartMeta(metaPath);
    const partStats = await stat(partPath).catch(() => null);
    if (
      meta !== null &&
      partStats !== null &&
      meta.url === file.url &&
      meta.expectedSha256 === file.sha256 &&
      meta.receivedBytes === partStats.size &&
      meta.receivedBytes > 0
    ) {
      resumeFrom = Math.min(meta.receivedBytes, file.bytes);
    }

    const progress: FileProgress = { installed: false, current: resumeFrom };
    run.progress.set(file.path, progress);

    /**
     * One full fetch-verify-rename pass. Each attempt gets its own abort
     * controller (cancel and the stall watchdog share it), and the stall
     * timer is re-armed on every received chunk, so "no bytes for 30s"
     * aborts without ever timing out a slow-but-alive transfer.
     */
    const attempt = async (): Promise<void> => {
      const attemptController = new AbortController();
      run.controllers.add(attemptController);
      let stalled = false;
      // Read through a getter: TypeScript's closure analysis keeps the
      // boolean at its initializer inside the catch below, which would make
      // the lint rule claim the flag is always false.
      const wasStalled = (): boolean => stalled;
      let stallTimer: NodeJS.Timeout | undefined;
      const armStall = (): void => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          stalled = true;
          attemptController.abort();
        }, stallTimeoutMs);
      };
      const disarmStall = (): void => {
        clearTimeout(stallTimer);
      };
      try {
        await acquireSlot();
        let received = resumeFrom;
        try {
          armStall();
          const options: RequestInit = { signal: attemptController.signal };
          if (resumeFrom > 0) {
            options.headers = { Range: `bytes=${String(resumeFrom)}-` };
          }
          const response = await deps.fetch(file.url, options);
          if (response.status !== 200 && response.status !== 206 && response.status !== 416) {
            throw new HttpStatusError(
              response.status,
              `HTTP ${String(response.status)} while downloading ${file.path}.`
            );
          }
          if (response.status === 416) {
            progress.current = resumeFrom;
          } else if (response.status === 206) {
            received = await streamBody(
              response,
              partPath,
              "append",
              resumeFrom,
              model,
              run,
              progress,
              armStall
            );
          } else {
            received = await streamBody(
              response,
              partPath,
              "truncate",
              0,
              model,
              run,
              progress,
              armStall
            );
          }
          disarmStall();
          progress.current = received;
          const nextMeta: PartMeta = {
            url: file.url,
            expectedSha256: file.sha256,
            receivedBytes: received
          };
          await writeFile(metaPath, JSON.stringify(nextMeta), "utf8");
        } finally {
          releaseSlot();
          disarmStall();
        }

        if (file.sha256 !== ZERO_HASH) {
          states.set(model.id, { state: "verifying" });
          const hash = await hashFile(partPath);
          if (hash !== file.sha256) {
            await rm(partPath, { force: true });
            await rm(metaPath, { force: true });
            throw new ChecksumError(
              `Hash mismatch for ${file.path}. The download is corrupt; retry.`
            );
          }
        }

        const finalPath = join(modelsRoot, model.id, file.path);
        await mkdir(dirname(finalPath), { recursive: true });
        await renameWithRetry(partPath, finalPath);
        await rm(metaPath, { force: true });
        progress.installed = true;
        progress.current = file.bytes;
      } catch (error) {
        disarmStall();
        if (wasStalled()) {
          throw new StallTimeoutError(
            `Download stalled while fetching ${file.path}. No data received for a while; retrying.`
          );
        }
        throw error;
      } finally {
        run.controllers.delete(attemptController);
      }
    };

    try {
      let lastError: Error | null = null;
      for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
        if (isCancelled(run)) {
          break;
        }
        try {
          await attempt();
          return "ok";
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (isCancelled(run)) {
            break;
          }
          const classified = classifyDownloadError(error);
          if (attemptNumber === maxAttempts || !classified.retryable) {
            break;
          }
          // Keep the bytes so the next attempt (and a manual retry) resumes
          // with a range request instead of starting over.
          await persistPartMeta(model, file, metaPath, partPath);
          await sleep(retryDelayMs * attemptNumber);
        }
      }
      if (lastError !== null) {
        throw lastError;
      }
      throw new Error("The download was cancelled before it started.");
    } catch (error) {
      if (isCancelled(run)) {
        await persistPartMeta(model, file, metaPath, partPath);
        return "aborted";
      }
      // Keep whatever made it to disk: a manual Retry or the next start
      // resumes from the real byte count instead of re-downloading.
      await persistPartMeta(model, file, metaPath, partPath);
      const classified = classifyDownloadError(error);
      states.set(model.id, {
        state: "error",
        code: classified.code,
        message: messageOf(error)
      });
      return "failed";
    }
  };

  const cancelRun = (modelId: string): void => {
    const run = runs.get(modelId);
    if (run === undefined) {
      return;
    }
    run.cancelled = true;
    for (const controller of run.controllers) {
      controller.abort();
    }
    states.set(modelId, { state: "idle" });
  };

  const runLoop = (model: DownloadBundle, run: Run): Promise<void> => {
    return (async (): Promise<void> => {
      try {
        for (const file of model.files) {
          if (await installedFile(model, file)) {
            run.progress.set(file.path, { installed: true, current: file.bytes });
          } else {
            const partStats = await stat(partPathFor(model, file)).catch(() => null);
            run.progress.set(file.path, {
              installed: false,
              current: partStats?.size ?? 0
            });
          }
        }
        // Files download concurrently, bounded by the shared slot semaphore.
        // A single connection to the CDN is bandwidth limited well below the
        // link, so running the files in parallel is several times faster than
        // awaiting them one at a time.
        setDownloading(model, run);
        // Pre-flight free-space check: a multi-GB model failing halfway with
        // ENOSPC is minutes wasted; refusing up front with a clear reason is
        // better. A statfs that fails (odd filesystems) is skipped and the
        // stream reports ENOSPC if it happens anyway.
        const needed = model.files.reduce((sum, file) => {
          if (run.progress.get(file.path)?.installed === true) {
            return sum;
          }
          return sum + file.bytes;
        }, 0);
        if (needed > 0) {
          try {
            const fsStats = await statfs(modelsRoot);
            if (fsStats.bavail * fsStats.bsize < needed) {
              states.set(model.id, {
                state: "error",
                code: "disk",
                message: `Not enough free disk space for ${model.name} (${String(Math.ceil(needed / 1_048_576))} MB needed).`
              });
              for (const controller of run.controllers) {
                controller.abort();
              }
              emitFinal(model, run);
              return;
            }
          } catch {
            // statfs unavailable; let the stream report ENOSPC if it bites.
          }
        }
        const outcomes = await Promise.all(
          model.files.map(async (file) => {
            if (isCancelled(run)) return "aborted" as const;
            return await downloadFile(model, file, run);
          })
        );
        const failed = outcomes.some(
          (outcome) => outcome === "failed" || outcome === "aborted"
        );
        if (failed) {
          // Every file has already settled by the time Promise.all resolves,
          // so this aborts nothing in flight. It is kept only to release the
          // controllers; the resume path relies on the partials staying put.
          for (const controller of run.controllers) {
            controller.abort();
          }
        }
        const current = states.get(model.id);
        if (isCancelled(run)) {
          states.set(model.id, { state: "idle" });
        } else if (current !== undefined && current.state === "error") {
          emitFinal(model, run);
        } else if (failed) {
          // A file failed without any per-file handler recording why. Falling
          // through to "done" here is what let a half-downloaded model report
          // success: the engine then claimed to be ready and failed at the
          // first capture instead.
          states.set(model.id, {
            state: "error",
            code: "unknown",
            message: `${model.name} did not download completely. Try again.`
          });
          emitFinal(model, run);
        } else {
          states.set(model.id, { state: "done" });
          emitFinal(model, run);
        }
      } catch (error) {
        const classified = classifyDownloadError(error);
        states.set(model.id, {
          state: "error",
          code: classified.code,
          message: messageOf(error)
        });
        emitFinal(model, run);
      } finally {
        runs.delete(model.id);
      }
    })();
  };

  return {
    start: (model: DownloadBundle): DownloadHandle => {
      const existing = runs.get(model.id);
      if (existing !== undefined && existing.handle !== undefined) {
        return existing.handle;
      }
      const run: Run = {
        cancelled: false,
        controllers: new Set(),
        progress: new Map(),
        lastEmit: 0
      };
      runs.set(model.id, run);
      const handle: DownloadHandle = {
        abort: () => {
          cancelRun(model.id);
        },
        done: runLoop(model, run)
      };
      run.handle = handle;
      return handle;
    },
    cancel: (modelId: string): void => {
      cancelRun(modelId);
    },
    state: (modelId: string): ModelDownloadState => {
      return states.get(modelId) ?? { state: "idle" };
    }
  };
};
