/**
 * Meeting asset service: downloads and installs the VAD, speaker embedding
 * and segmentation models into userData/meeting-assets, built on the same
 * resumable downloader the Models page uses. Kept separate from
 * ModelsService so the Models view stays about transcription quality and its
 * disk total keeps meaning "transcription models".
 */

import { join } from "node:path";
import {
  MEETING_ASSETS,
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
  }
): MeetingAssetService => {
  const installer: ModelInstaller = createModelInstaller(assetsRoot);
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
      installed: installer.isInstalled(asset),
      download: states.get(asset.id) ?? { state: "idle" }
    }));
    return {
      items,
      ready: MEETING_ASSETS.filter((asset) => asset.required).every((asset) =>
        installer.isInstalled(asset)
      )
    };
  };

  const installMissing = async (): Promise<void> => {
    const missing = MEETING_ASSETS.filter((asset) => !installer.isInstalled(asset));
    for (const asset of missing) {
      const handle = downloader.start(asset);
      await handle.done;
      states.set(
        asset.id,
        installer.isInstalled(asset) ? { state: "done" } : downloader.state(asset.id)
      );
    }
    notify();
  };

  const pathFor = (role: MeetingAssetRole): string | null => {
    const asset = MEETING_ASSETS.find((candidate) => candidate.role === role);
    if (asset === undefined) return null;
    const file = asset.files[0];
    if (file === undefined) return null;
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
