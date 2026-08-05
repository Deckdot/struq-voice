/**
 * Downloads catalog models into `modelsRoot`. Verified files live at
 * `modelsRoot/<modelId>/<file.path>`; in-progress parts live at
 * `modelsRoot/<modelId>/.partial/<file.path>.part` beside a JSON meta file
 * with the source url, expected hash and bytes received so far. Parts are
 * resumed with HTTP range requests, downloads are capped at three concurrent
 * file transfers across all models, and progress is emitted per model on a
 * 250ms throttle with a single final emit on done or error.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelDownloadState, ModelFile, ModelInfo } from "../../shared/models";

const ZERO_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const MAX_CONCURRENT_FILES = 3;
const PROGRESS_INTERVAL_MS = 250;

export interface DownloadDeps {
  readonly fetch: typeof fetch;
  readonly emitProgress: (event: {
    modelId: string;
    receivedBytes: number;
    totalBytes: number;
  }) => void;
}

export interface DownloadHandle {
  readonly abort: () => void;
  readonly done: Promise<void>;
}

export interface Downloader {
  start: (model: ModelInfo) => DownloadHandle;
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

export const createDownloader = (modelsRoot: string, deps: DownloadDeps): Downloader => {
  const states = new Map<string, ModelDownloadState>();
  const runs = new Map<string, Run>();
  const queue: Array<() => void> = [];
  let activeDownloads = 0;

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

  const installedFile = async (model: ModelInfo, file: ModelFile): Promise<boolean> => {
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

  const partPathFor = (model: ModelInfo, file: ModelFile): string =>
    join(modelsRoot, model.id, ".partial", `${file.path}.part`);

  const metaPathFor = (model: ModelInfo, file: ModelFile): string =>
    `${partPathFor(model, file)}.json`;

  const readPartMeta = async (metaPath: string): Promise<PartMeta | null> => {
    try {
      const raw = await readFile(metaPath, "utf8");
      return JSON.parse(raw) as PartMeta;
    } catch {
      return null;
    }
  };

  const receivedBytes = (model: ModelInfo, run: Run): number => {
    let total = 0;
    for (const file of model.files) {
      const progress = run.progress.get(file.path);
      if (progress !== undefined) {
        total += progress.installed ? file.bytes : progress.current;
      }
    }
    return total;
  };

  const emitThrottled = (model: ModelInfo, run: Run): void => {
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

  const emitFinal = (model: ModelInfo, run: Run): void => {
    deps.emitProgress({
      modelId: model.id,
      receivedBytes: receivedBytes(model, run),
      totalBytes: model.bytes
    });
  };

  const setDownloading = (model: ModelInfo, run: Run): void => {
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
    model: ModelInfo,
    run: Run,
    progress: FileProgress
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
        emitThrottled(model, run);
        if (!canContinue) {
          await new Promise<void>((resolve) => {
            const done = (): void => {
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
        stream.once("error", reject);
        stream.end(resolve);
      });
      return received;
    } catch (error) {
      stream.destroy();
      throw error;
    }
  };

  const downloadFile = async (
    model: ModelInfo,
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

    const controller = new AbortController();
    run.controllers.add(controller);
    const progress: FileProgress = { installed: false, current: resumeFrom };
    run.progress.set(file.path, progress);

    try {
      await acquireSlot();
      let received = resumeFrom;
      try {
        const options: RequestInit = { signal: controller.signal };
        if (resumeFrom > 0) {
          options.headers = { Range: `bytes=${String(resumeFrom)}-` };
        }
        const response = await deps.fetch(file.url, options);
        if (response.status !== 200 && response.status !== 206 && response.status !== 416) {
          throw new Error(`HTTP ${String(response.status)} while downloading ${file.path}.`);
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
            progress
          );
        } else {
          received = await streamBody(response, partPath, "truncate", 0, model, run, progress);
        }
        progress.current = received;
        const nextMeta: PartMeta = {
          url: file.url,
          expectedSha256: file.sha256,
          receivedBytes: received
        };
        await writeFile(metaPath, JSON.stringify(nextMeta), "utf8");
      } finally {
        releaseSlot();
      }

      if (file.sha256 !== ZERO_HASH) {
        states.set(model.id, { state: "verifying" });
        const hash = await hashFile(partPath);
        if (hash !== file.sha256) {
          await rm(partPath, { force: true });
          await rm(metaPath, { force: true });
          throw new Error(`Hash mismatch for ${file.path}. The download is corrupt; retry.`);
        }
      }

      const finalPath = join(modelsRoot, model.id, file.path);
      await mkdir(dirname(finalPath), { recursive: true });
      await rename(partPath, finalPath);
      await rm(metaPath, { force: true });
      progress.installed = true;
      progress.current = file.bytes;
      return "ok";
    } catch (error) {
      if (isCancelled(run)) {
        const safeMeta: PartMeta = {
          url: file.url,
          expectedSha256: file.sha256,
          receivedBytes: progress.current
        };
        await writeFile(metaPath, JSON.stringify(safeMeta), "utf8").catch(() => {});
        return "aborted";
      }
      states.set(model.id, { state: "error", message: messageOf(error) });
      return "failed";
    } finally {
      run.controllers.delete(controller);
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

  const runLoop = (model: ModelInfo, run: Run): Promise<void> => {
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
        for (const file of model.files) {
          if (isCancelled(run)) {
            break;
          }
          setDownloading(model, run);
          const outcome = await downloadFile(model, file, run);
          if (outcome === "failed" || outcome === "aborted") {
            break;
          }
        }
        const current = states.get(model.id);
        if (isCancelled(run)) {
          states.set(model.id, { state: "idle" });
        } else if (current !== undefined && current.state === "error") {
          emitFinal(model, run);
        } else {
          states.set(model.id, { state: "done" });
          emitFinal(model, run);
        }
      } catch (error) {
        states.set(model.id, { state: "error", message: messageOf(error) });
        emitFinal(model, run);
      } finally {
        runs.delete(model.id);
      }
    })();
  };

  return {
    start: (model: ModelInfo): DownloadHandle => {
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
