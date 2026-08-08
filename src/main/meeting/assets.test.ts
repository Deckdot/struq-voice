import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_ASSETS } from "../../shared/meeting-assets";
import { createMeetingAssetService } from "./assets";

/**
 * The installer ships the meeting models, so the service has to treat a
 * bundled file as installed and never fetch it. The userData root stays as the
 * repair path for a dev checkout or a file that went missing.
 */

let bundledRoot: string;
let userDataRoot: string;

const place = (root: string, assetIndex: number): void => {
  const asset = MEETING_ASSETS[assetIndex];
  if (asset === undefined) throw new Error("no such asset");
  const file = asset.files[0];
  if (file === undefined) throw new Error("asset has no files");
  mkdirSync(join(root, asset.id), { recursive: true });
  writeFileSync(join(root, asset.id, file.path), "x");
};

const placeAll = (root: string): void => {
  MEETING_ASSETS.forEach((_asset, index) => {
    place(root, index);
  });
};

beforeEach(() => {
  bundledRoot = mkdtempSync(join(tmpdir(), "struq-bundled-"));
  userDataRoot = mkdtempSync(join(tmpdir(), "struq-userdata-"));
});

afterEach(() => {
  rmSync(bundledRoot, { recursive: true, force: true });
  rmSync(userDataRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("meeting assets", () => {
  it("is ready from the bundled root alone, with nothing in userData", () => {
    placeAll(bundledRoot);
    const service = createMeetingAssetService(userDataRoot, { bundledRoot });

    expect(service.isReady()).toBe(true);
    expect(service.list().items.every((item) => item.installed)).toBe(true);
  });

  it("downloads nothing when the assets are bundled", async () => {
    placeAll(bundledRoot);
    const fetchSpy = vi.fn();
    const service = createMeetingAssetService(userDataRoot, {
      bundledRoot,
      fetch: fetchSpy as unknown as typeof fetch
    });

    await service.installMissing();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves paths into the bundled root", () => {
    placeAll(bundledRoot);
    const service = createMeetingAssetService(userDataRoot, { bundledRoot });

    expect(service.pathFor("vad")?.startsWith(bundledRoot)).toBe(true);
  });

  it("prefers the bundled copy over one left in userData", () => {
    placeAll(bundledRoot);
    placeAll(userDataRoot);
    const service = createMeetingAssetService(userDataRoot, { bundledRoot });

    // A stale repair download must never shadow the file this build shipped.
    expect(service.pathFor("embedding")?.startsWith(bundledRoot)).toBe(true);
  });

  it("falls back to userData when nothing is bundled", () => {
    placeAll(userDataRoot);
    const service = createMeetingAssetService(userDataRoot, { bundledRoot });

    expect(service.isReady()).toBe(true);
    expect(service.pathFor("vad")?.startsWith(userDataRoot)).toBe(true);
  });

  it("is not ready when a required asset is absent from both roots", () => {
    // Only the optional segmentation model is present.
    const optionalIndex = MEETING_ASSETS.findIndex((asset) => !asset.required);
    expect(optionalIndex).toBeGreaterThanOrEqual(0);
    place(bundledRoot, optionalIndex);

    const service = createMeetingAssetService(userDataRoot, { bundledRoot });

    expect(service.isReady()).toBe(false);
  });

  it("reports a missing asset as having no path rather than a broken one", () => {
    const service = createMeetingAssetService(userDataRoot, { bundledRoot });

    expect(service.pathFor("vad")).toBeNull();
  });
});
