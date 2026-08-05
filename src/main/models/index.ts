/**
 * Composes the model installer and downloader behind a single facade for the
 * ipc layer. Snapshots the whole catalog as `ModelStatus[]`, starts and cancels
 * downloads, deletes installed models, and broadcasts status changes to
 * subscribers on every download progress tick. Progress is forwarded
 * unthrottled here; the ipc layer throttles what reaches the renderer. No
 * Electron imports; the module only wires together the two model primitives.
 */

import { MODEL_CATALOG, findModel, type ModelStatus } from "../../shared/models";
import { createDownloader, type Downloader } from "./downloader";
import { createModelInstaller, type ModelInstaller } from "./installer";

export interface ModelProgressEvent {
  modelId: string;
  receivedBytes: number;
  totalBytes: number;
}

export interface ModelList {
  readonly items: ModelStatus[];
  readonly totalDiskUsed: number;
}

export interface ModelsService {
  list: () => ModelList;
  startDownload: (modelId: string) => boolean;
  cancelDownload: (modelId: string) => boolean;
  deleteModel: (modelId: string) => Promise<boolean>;
  subscribe: (listener: (listed: ModelList) => void) => () => void;
  dispose: () => void;
}

export const createModelsService = (
  modelsRoot: string,
  deps?: { emitProgress?: (event: ModelProgressEvent) => void }
): ModelsService => {
  const installer: ModelInstaller = createModelInstaller(modelsRoot);
  const listeners = new Set<(listed: ModelList) => void>();

  const list = (): ModelList => ({
    items: MODEL_CATALOG.map((model) => ({
      model,
      installed: installer.isInstalled(model),
      installedBytes: installer.installedBytes(model),
      download: downloader.state(model.id)
    })),
    totalDiskUsed: installer.totalDiskUsed()
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
    fetch: globalThis.fetch,
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
    await installer.delete(model);
    notifyListeners();
    return true;
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
    subscribe,
    dispose
  };
};
