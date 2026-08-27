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
      const service = createModelsService(root, join(root, "..", "runtimes"));

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
      const service = createModelsService(root, join(root, "..", "runtimes"));

      expect(service.startDownload("does-not-exist")).toBe(false);
    })
  );

  it("deletes an installed model and reports it as uninstalled", async () => {
    await withRoot(async (root) => {
      const service = createModelsService(root, join(root, "..", "runtimes"));
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
      const service = createModelsService(root, join(root, "..", "runtimes"));
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

  it("imports a directory and reports checksum mismatch on bad content", async () => {
    await withRoot(async (root) => {
      const service = createModelsService(root, join(root, "..", "runtimes"));
      const target = MODEL_CATALOG[0]!;

      // A source directory holding the catalog file names but wrong bytes.
      const source = mkdtempSync(join(tmpdir(), "sv-import-"));
      for (const file of target.files) {
        installFile(source, "", file.path, "not the real model bytes");
      }

      const outcome = await service.importFromDirectory(target.id, source);
      expect(outcome.ok).toBe(false);
      // The import reported the checksum mismatch; a partial import is not a
      // usable model even though the files were copied to disk.

      await rm(source, { recursive: true, force: true });
    });
  });

  it("rejects importing an unknown model id", async () => {
    await withRoot(async (root) => {
      const service = createModelsService(root, join(root, "..", "runtimes"));
      const outcome = await service.importFromDirectory("does-not-exist", root);
      expect(outcome.ok).toBe(false);
    });
  });

  it("does not reject deleteModel while a download is in flight", async () => {
    await withRoot(async (root) => {
      const service = createModelsService(root, join(root, "..", "runtimes"), {
        fetch: (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          })
      });
      const target = MODEL_CATALOG[0]!;

      expect(service.startDownload(target.id)).toBe(true);
      const deleted = await service.deleteModel(target.id);

      expect(deleted).toBe(true);
      expect(service.list().items.find((s) => s.model.id === target.id)?.installed).toBe(false);
      service.dispose();
    });
  });
});

/**
 * Boot-time runtime install. A fresh profile should end up with whisper-cli.exe
 * without the user hunting for the button in Models, and an already-installed
 * runtime must not re-download.
 */
describe("ensureWhisperRuntime", () => {
  // The whole runtime, not just the exe: whisper-cli.exe is dynamically
  // linked, so an exe-only directory now counts as a broken install that
  // ensureWhisperRuntime is expected to repair.
  const installCli = (runtimeRoot: string): void => {
    mkdirSync(join(runtimeRoot, "whisper-cpp"), { recursive: true });
    for (const name of [
      "whisper-cli.exe",
      "whisper.dll",
      "ggml.dll",
      "ggml-base.dll",
      "ggml-cpu-haswell.dll"
    ]) {
      writeFileSync(join(runtimeRoot, "whisper-cpp", name), "fake", "utf8");
    }
  };

  it("does not fetch when the runtime is already installed", async () => {
    await withRoot((root) => {
      const runtimeRoot = join(root, "runtimes");
      installCli(runtimeRoot);
      let fetched = 0;
      const service = createModelsService(root, runtimeRoot, {
        fetch: (() => {
          fetched += 1;
          throw new Error("should not fetch");
        }) as unknown as typeof fetch
      });
      service.ensureWhisperRuntime();
      expect(fetched).toBe(0);
      expect(service.list().whisperRuntime.state).toBe("done");
      service.dispose();
    });
  });

  it("starts a download when the runtime is missing", async () => {
    await withRoot(async (root) => {
      const runtimeRoot = join(root, "runtimes");
      let fetched = 0;
      const service = createModelsService(root, runtimeRoot, {
        fetch: (() => {
          fetched += 1;
          return Promise.reject(new Error("offline"));
        }) as unknown as typeof fetch
      });
      service.ensureWhisperRuntime();
      // The install runs detached and awaits mkdir before fetching, so poll
      // rather than assuming a fixed number of ticks.
      const deadline = Date.now() + 2000;
      while (fetched === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(fetched).toBe(1);
      service.dispose();
    });
  });

  // A failed install must not crash boot; it leaves an error the Models view
  // renders, and the manual button stays available as the retry.
  it("records an error instead of throwing when the download fails", async () => {
    await withRoot(async (root) => {
      const runtimeRoot = join(root, "runtimes");
      const service = createModelsService(root, runtimeRoot, {
        fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch
      });
      await service.installWhisperRuntime();
      const state = service.list().whisperRuntime;
      expect(state.state).toBe("error");
      service.dispose();
    });
  });

  it("joins an in-flight runtime install instead of starting a second one", async () => {
    await withRoot(async (root) => {
      const runtimeRoot = join(root, "runtimes");
      let fetches = 0;
      let release!: () => void;
      let signalFetchStarted!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fetchStarted = new Promise<void>((resolve) => {
        signalFetchStarted = resolve;
      });
      const service = createModelsService(root, runtimeRoot, {
        fetch: (async () => {
          fetches += 1;
          signalFetchStarted();
          await gate;
          throw new Error("offline");
        }) as unknown as typeof fetch
      });

      const first = service.installWhisperRuntime();
      const second = service.installWhisperRuntime();
      await fetchStarted;
      expect(fetches).toBe(1);

      release();
      await Promise.all([first, second]);
      expect(service.list().whisperRuntime.state).toBe("error");
      service.dispose();
    });
  });
});
