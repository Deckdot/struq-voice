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

/**
 * The GPU runtime is reported separately from the CPU one because it is a
 * different decision for the user: the CPU build is 8MB and installs itself
 * at boot, the CUDA build is 670MB and only makes sense on an NVIDIA card, so
 * it is offered rather than fetched.
 */
export interface GpuRuntimeState {
  /** Whether this machine has a card the CUDA build could use. */
  readonly supported: boolean;
  /** Download size, so the UI can say what it is asking for. */
  readonly bytes: number;
  readonly install: RuntimeState;
}

export interface ModelList {
  readonly items: ModelStatus[];
  readonly totalDiskUsed: number;
  readonly whisperRuntime: RuntimeState;
  readonly whisperGpu: GpuRuntimeState;
}

export interface ModelsService {
  list: () => ModelList;
  startDownload: (modelId: string) => boolean;
  cancelDownload: (modelId: string) => boolean;
  deleteModel: (modelId: string) => Promise<boolean>;
  installWhisperRuntime: () => Promise<void>;
  /** Install the runtime in the background at boot if it is missing. */
  ensureWhisperRuntime: () => void;
  /** Swap the runtime for the CUDA build. User-initiated; it is 670MB. */
  installWhisperGpuRuntime: () => Promise<void>;
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
    /**
     * Whether the machine has an NVIDIA card. Read at call time because
     * hardware detection resolves after this service is built, and a GPU
     * offer that only appears on the next launch is an offer nobody sees.
     */
    hasNvidiaGpu?: () => boolean;
  }
): ModelsService => {
  const installer: ModelInstaller = createModelInstaller(modelsRoot);
  const runtimeDownloader: RuntimeDownloader = createRuntimeDownloader(runtimeRoot, {
    fetch: deps?.fetch ?? globalThis.fetch
  });
  const listeners = new Set<(listed: ModelList) => void>();
  let runtimeState: RuntimeState = { state: "idle" };
  let gpuState: RuntimeState = { state: "idle" };

  const list = (): ModelList => ({
    items: MODEL_CATALOG.map((model) => ({
      model,
      installed: installer.isInstalled(model),
      installedBytes: installer.installedBytes(model),
      download: downloader.state(model.id)
    })),
    totalDiskUsed: installer.totalDiskUsed(),
    whisperRuntime: runtimeState,
    whisperGpu: {
      supported: deps?.hasNvidiaGpu?.() ?? false,
      bytes: runtimeDownloader.cudaBytesTotal(),
      // Installed wins over whatever the last attempt reported: the runtime on
      // disk is the fact, gpuState is only the story of this session.
      install: runtimeDownloader.isCudaInstalled() ? { state: "done" } : gpuState
    }
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

  // CPU and CUDA installs both publish to whisper-cpp/. They must share one
  // lock: otherwise a boot-time CPU install and a user-initiated CUDA install
  // erase each other's staging directory and can leave a mixed runtime.
  let runtimeInstallInFlight: Promise<void> | null = null;

  const runRuntimeInstall = async (): Promise<void> => {
    runtimeState = { state: "downloading", receivedBytes: 0, totalBytes: runtimeDownloader.bytesTotal() };
    notifyListeners();
    // Both variants share one progress stream, so a listener has to ignore
    // the other one's ticks or a GPU install would drive the CPU progress bar.
    const unsubscribe = runtimeDownloader.onProgress((received, total, variant) => {
      if (variant !== "cpu") return;
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

  const runGpuInstall = async (): Promise<void> => {
    gpuState = {
      state: "downloading",
      receivedBytes: 0,
      totalBytes: runtimeDownloader.cudaBytesTotal()
    };
    notifyListeners();
    const unsubscribe = runtimeDownloader.onProgress((received, total, variant) => {
      if (variant !== "cuda") return;
      gpuState = { state: "downloading", receivedBytes: received, totalBytes: total };
      notifyListeners();
    });
    try {
      await runtimeDownloader.installCuda();
      gpuState = { state: "done" };
      // The CUDA build replaces the CPU one wholesale, so the plain runtime is
      // installed by definition once this succeeds.
      runtimeState = { state: "done" };
    } catch (error) {
      gpuState = {
        state: "error",
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      unsubscribe();
      notifyListeners();
    }
  };

  const installWhisperGpuRuntime = async (): Promise<void> => {
    if (runtimeDownloader.isCudaInstalled()) {
      gpuState = { state: "done" };
      notifyListeners();
      return;
    }
    if (runtimeInstallInFlight !== null) {
      await runtimeInstallInFlight;
      // The preceding install may have been the CUDA build, or a CPU build
      // that left this request still needed. Re-check against the filesystem
      // before deciding which case we have.
      await installWhisperGpuRuntime();
      return;
    }
    runtimeInstallInFlight = runGpuInstall().finally(() => {
      runtimeInstallInFlight = null;
    });
    await runtimeInstallInFlight;
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
    installWhisperGpuRuntime,
    importFromDirectory,
    subscribe,
    dispose
  };
};
