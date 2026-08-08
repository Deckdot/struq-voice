/**
 * Meeting asset service: resolves the VAD, speaker embedding and segmentation
 * models a meeting needs. Kept separate from ModelsService so the Models view
 * stays about transcription quality and its disk total keeps meaning
 * "transcription models".
 *
 * The installer ships these, so in a packaged build they are already present
 * under resources/meeting-assets and nothing is ever downloaded. The
 * downloader remains as the repair path: a dev checkout that has not vendored
 * them, or an install whose files went missing, fetches into
 * userData/meeting-assets. A bundled asset always wins over a fetched one, so
 * a repair cannot shadow a good file with a stale one.
 */

import { join } from "node:path";
import {
  MEETING_ASSETS,
  type MeetingAsset,
  type MeetingAssetId,
  type MeetingAssetRole
} from "../../shared/meeting-assets";
import type { MeetingAssetsResult, MeetingAssetStatus } from "../../shared/ipc";
import type { ModelDownloadState } from "../../shared/models";
import { createDownloader, type Downloader } from "../models/downloader";
import { createModelInstaller, type ModelInstaller } from "../models/installer";

export interface MeetingAssetService {
  list: () => MeetingAssetsResult;
  /** True when every required asset is present. */
  isReady: () => boolean;
  installMissing: () => Promise<void>;
  pathFor: (role: MeetingAssetRole) => string | null;
  subscribe: (listener: (result: MeetingAssetsResult) => void) => () => void;
}

export const createMeetingAssetService = (
  assetsRoot: string,
  deps?: {
    /** Injected so tests can exercise the install without a network. */
    fetch?: typeof fetch;
    /**
     * Where the installer put the bundled copies, read only. Checked before
     * assetsRoot, so a shipped asset is never re-downloaded.
     */
    bundledRoot?: string;
  }
): MeetingAssetService => {
  const installer: ModelInstaller = createModelInstaller(assetsRoot);
  const bundled: ModelInstaller | null =
    deps?.bundledRoot === undefined ? null : createModelInstaller(deps.bundledRoot);

  const isPresent = (asset: MeetingAsset): boolean =>
    (bundled?.isInstalled(asset) ?? false) || installer.isInstalled(asset);
  const states = new Map<string, ModelDownloadState>();
  const listeners = new Set<(result: MeetingAssetsResult) => void>();

  const notify = (): void => {
    const result = list();
    for (const listener of listeners) {
      listener(result);
    }
  };

  const internalEmitter = (event: { modelId: string; receivedBytes: number; totalBytes: number }): void => {
    states.set(event.modelId, {
      state: "downloading",
      receivedBytes: event.receivedBytes,
      totalBytes: event.totalBytes
    });
    notify();
  };

  const downloader: Downloader = createDownloader(assetsRoot, {
    fetch: deps?.fetch ?? globalThis.fetch,
    emitProgress: internalEmitter
  });

  const list = (): MeetingAssetsResult => {
    const items: MeetingAssetStatus[] = MEETING_ASSETS.map((asset) => ({
      id: asset.id,
      name: asset.name,
      purpose: asset.purpose,
      bytes: asset.bytes,
      required: asset.required,
      installed: isPresent(asset),
      download: states.get(asset.id) ?? { state: "idle" }
    }));
    return {
      items,
      ready: MEETING_ASSETS.filter((asset) => asset.required).every(isPresent)
    };
  };

  const installMissing = async (): Promise<void> => {
    const missing = MEETING_ASSETS.filter((asset) => !isPresent(asset));
    for (const asset of missing) {
      const handle = downloader.start(asset);
      await handle.done;
      states.set(
        asset.id,
        isPresent(asset) ? { state: "done" } : downloader.state(asset.id)
      );
    }
    notify();
  };

  const pathFor = (role: MeetingAssetRole): string | null => {
    const asset = MEETING_ASSETS.find((candidate) => candidate.role === role);
    if (asset === undefined) return null;
    const file = asset.files[0];
    if (file === undefined) return null;
    // The bundled copy wins: it shipped with this build and was verified at
    // build time, so it cannot be a stale leftover from an older version.
    if (bundled !== null && bundled.isInstalled(asset)) {
      return join(deps?.bundledRoot ?? "", asset.id, file.path);
    }
    if (!installer.isInstalled(asset)) return null;
    return join(assetsRoot, asset.id, file.path);
  };

  return {
    list,
    isReady: () => list().ready,
    installMissing,
    pathFor,
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};

export type { MeetingAssetId };
