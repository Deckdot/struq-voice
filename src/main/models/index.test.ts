/**
 * Tests for the model service facade that composes installer and downloader.
 * No model is ever downloaded: the second catalog model is installed by
 * writing its files directly, and the subscriber wiring is checked through
 * cancelDownload so no network fetch is needed.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../../shared/models";
import { createModelsService } from "./index";

const installFile = (root: string, modelId: string, path: string, content: string): void => {
  const target = join(root, modelId, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
};

const withRoot = async (fn: (root: string) => void | Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "sv-models-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("model service", () => {
  it("reflects catalog installation state from disk", () =>
    withRoot((root) => {
      const service = createModelsService(root);

      const empty = service.list().items;
      expect(empty).toHaveLength(MODEL_CATALOG.length);
      for (const status of empty) {
        expect(status.installed).toBe(false);
        expect(status.installedBytes).toBe(0);
      }

      const target = MODEL_CATALOG[1]!;
      for (const file of target.files) {
        installFile(root, target.id, file.path, "fake-content");
      }

      const after = service.list().items;
      const installed = after.find((status) => status.model.id === target.id);
      expect(installed?.installed).toBe(true);
      expect(installed?.installedBytes).toBeGreaterThan(0);
    }));


  it("rejects startDownload for an unknown model id", () =>
    withRoot((root) => {
      const service = createModelsService(root);

      expect(service.startDownload("does-not-exist")).toBe(false);
    })
  );

  it("deletes an installed model and reports it as uninstalled", async () => {
    await withRoot(async (root) => {
      const service = createModelsService(root);
      const target = MODEL_CATALOG[1]!;
      for (const file of target.files) {
        installFile(root, target.id, file.path, "fake-content");
      }
      expect(service.list().items.find((s) => s.model.id === target.id)?.installed).toBe(true);

      const deleted = await service.deleteModel(target.id);

      expect(deleted).toBe(true);
      expect(service.list().items.find((s) => s.model.id === target.id)?.installed).toBe(false);
    });
  });

  it("notifies subscribers on a download state change", () =>
    withRoot((root) => {
      const service = createModelsService(root);
      const target = MODEL_CATALOG[0]!;
      let calls = 0;
      const unsubscribe = service.subscribe(() => {
        calls += 1;
      });

      expect(service.cancelDownload(target.id)).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(1);

      unsubscribe();
    })
  );
});
