/**
 * Composes the model installer and downloader behind a single facade for the
 * ipc layer. Snapshots the whole catalog as `ModelStatus[]`, starts and cancels
 * downloads, deletes installed models, and broadcasts status changes to
 * subscribers on every download progress tick. Progress is forwarded
 * unthrottled here; the ipc layer throttles what reaches the renderer. No
 * Electron imports; the module only wires together the two model primitives.
 */

import { MODEL_CATALOG, findModel, type ModelStatus } from "../../shared/models";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../../shared/result";
import { fail, ok } from "../../shared/result";
import { createDownloader, type Downloader } from "./downloader";
import { createModelInstaller, type ModelInstaller } from "./installer";
import { createRuntimeDownloader, type RuntimeDownloader } from "./runtime";

export interface ModelProgressEvent {
  modelId: string;
  receivedBytes: number;
  totalBytes: number;
}

export type RuntimeState =
  | { readonly state: "idle" }
  | { readonly state: "downloading"; readonly receivedBytes: number; readonly totalBytes: number }
  | { readonly state: "done" }
  | { readonly state: "error"; readonly message: string };

export interface ModelList {
  readonly items: ModelStatus[];
  readonly totalDiskUsed: number;
  readonly whisperRuntime: RuntimeState;
}

export interface ModelsService {
  list: () => ModelList;
  startDownload: (modelId: string) => boolean;
  cancelDownload: (modelId: string) => boolean;
  deleteModel: (modelId: string) => Promise<boolean>;
  installWhisperRuntime: () => Promise<void>;
  /** Install the runtime in the background at boot if it is missing. */
  ensureWhisperRuntime: () => void;
  /** Copy and verify catalog files from an existing local directory. */
  importFromDirectory: (modelId: string, sourceDir: string) => Promise<Result<void>>;
  subscribe: (listener: (listed: ModelList) => void) => () => void;
  dispose: () => void;
}

export const createModelsService = (
  modelsRoot: string,
  runtimeRoot: string,
  deps?: {
    emitProgress?: (event: ModelProgressEvent) => void;
    /** Injected so tests can exercise the runtime install without a network. */
    fetch?: typeof fetch;
  }
): ModelsService => {
  const installer: ModelInstaller = createModelInstaller(modelsRoot);
  const runtimeDownloader: RuntimeDownloader = createRuntimeDownloader(runtimeRoot, {
    fetch: deps?.fetch ?? globalThis.fetch
  });
  const listeners = new Set<(listed: ModelList) => void>();
  let runtimeState: RuntimeState = { state: "idle" };

  const list = (): ModelList => ({
    items: MODEL_CATALOG.map((model) => ({
      model,
      installed: installer.isInstalled(model),
      installedBytes: installer.installedBytes(model),
      download: downloader.state(model.id)
    })),
    totalDiskUsed: installer.totalDiskUsed(),
    whisperRuntime: runtimeState
  });

  const notifyListeners = (): void => {
    const listed = list();
    for (const listener of listeners) {
      listener(listed);
    }
  };

  const internalEmitter = (event: ModelProgressEvent): void => {
    deps?.emitProgress?.(event);
    notifyListeners();
  };

  const downloader: Downloader = createDownloader(modelsRoot, {
    fetch: deps?.fetch ?? globalThis.fetch,
    emitProgress: internalEmitter
  });

  const startDownload = (modelId: string): boolean => {
    const model = findModel(modelId);
    if (model === null) {
      return false;
    }
    const state = downloader.state(modelId);
    if (state.state === "downloading" || state.state === "verifying") {
      return true;
    }
    const handle = downloader.start(model);
    void handle.done.finally(() => {
      notifyListeners();
    });
    return true;
  };

  const cancelDownload = (modelId: string): boolean => {
    if (findModel(modelId) === null) {
      return false;
    }
    downloader.cancel(modelId);
    notifyListeners();
    return true;
  };

  const deleteModel = async (modelId: string): Promise<boolean> => {
    const model = findModel(modelId);
    if (model === null) {
      return false;
    }
    const state = downloader.state(modelId);
    if (state.state === "downloading" || state.state === "verifying") {
      downloader.cancel(modelId);
    }
    try {
      // The installer retries EPERM/EBUSY, so an aborted stream still holding
      // its .part open settles before the rm gives up.
      await installer.delete(model);
    } catch {
      // A delete that fails on a locked file must not reject the IPC invoke;
      // the caller refreshes and the row still shows the model.
      return false;
    }
    notifyListeners();
    return true;
  };

  let runtimeInstallInFlight: Promise<void> | null = null;

  const runRuntimeInstall = async (): Promise<void> => {
    runtimeState = { state: "downloading", receivedBytes: 0, totalBytes: runtimeDownloader.bytesTotal() };
    notifyListeners();
    const unsubscribe = runtimeDownloader.onProgress((received, total) => {
      runtimeState = { state: "downloading", receivedBytes: received, totalBytes: total };
      notifyListeners();
    });
    try {
      await runtimeDownloader.install();
      runtimeState = { state: "done" };
    } catch (error) {
      runtimeState = {
        state: "error",
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      unsubscribe();
      notifyListeners();
    }
  };

  const installWhisperRuntime = async (): Promise<void> => {
    if (runtimeInstallInFlight !== null) {
      // A second click during an install joins the one in flight instead of
      // reporting success for a run that has not happened yet.
      await runtimeInstallInFlight;
      return;
    }
    if (runtimeDownloader.isInstalled()) {
      runtimeState = { state: "done" };
      notifyListeners();
      return;
    }
    runtimeInstallInFlight = runRuntimeInstall().finally(() => {
      runtimeInstallInFlight = null;
    });
    await runtimeInstallInFlight;
  };

  /**
   * Fetch the whisper runtime at boot so the engine is usable the first time
   * the user selects it, rather than failing with "runtime not installed" and
   * making them find the button in Models. Already-installed is a no-op, and a
   * failure only leaves runtimeState in error: boot is never blocked, and the
   * manual button in Models remains the retry path.
   */
  const ensureWhisperRuntime = (): void => {
    if (runtimeDownloader.isInstalled()) {
      runtimeState = { state: "done" };
      return;
    }
    void installWhisperRuntime();
  };

  const importFromDirectory = async (
    modelId: string,
    sourceDir: string
  ): Promise<Result<void>> => {
    const model = findModel(modelId);
    if (model === null) {
      return fail({ code: "UNKNOWN", message: `Unknown model "${modelId}".` });
    }
    const targetDir = join(modelsRoot, model.id);
    try {
      await mkdir(targetDir, { recursive: true });
      for (const file of model.files) {
        await copyFile(join(sourceDir, file.path), join(targetDir, file.path));
      }
    } catch (error) {
      return fail({
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : "Could not import the model directory."
      });
    }
    const verified = await installer.verify(model);
    notifyListeners();
    if (!verified) {
      return fail({
        code: "UNKNOWN",
        message:
          "The files were copied but did not match the expected checksums. Remove and re-import a complete model folder."
      });
    }
    return ok(undefined);
  };

  const subscribe = (
    listener: (listed: ModelList) => void
  ): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const dispose = (): void => {
    listeners.clear();
  };

  return {
    list,
    startDownload,
    cancelDownload,
    deleteModel,
    installWhisperRuntime,
    ensureWhisperRuntime,
    importFromDirectory,
    subscribe,
    dispose
  };
};
