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

/**
 * The GPU runtime. It is a 670MB download that only helps on an NVIDIA card,
 * so the service reports whether to offer it at all and never fetches it on
 * its own the way the 8MB CPU runtime does.
 */
describe("whisper GPU runtime", () => {
  const installRuntime = (runtimeRoot: string, cuda: boolean): void => {
    mkdirSync(join(runtimeRoot, "whisper-cpp"), { recursive: true });
    const names = [
      "whisper-cli.exe",
      "whisper.dll",
      "ggml.dll",
      "ggml-base.dll",
      "ggml-cpu-haswell.dll",
      ...(cuda
        ? ["ggml-cuda.dll", "cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"]
        : [])
    ];
    for (const name of names) {
      writeFileSync(join(runtimeRoot, "whisper-cpp", name), "fake", "utf8");
    }
  };

  it("does not offer the GPU build without an NVIDIA card", async () => {
    await withRoot((root) => {
      const service = createModelsService(root, join(root, "runtimes"), {
        hasNvidiaGpu: () => false
      });
      expect(service.list().whisperGpu.supported).toBe(false);
      service.dispose();
    });
  });

  it("offers the GPU build on an NVIDIA card, with its download size", async () => {
    await withRoot((root) => {
      const service = createModelsService(root, join(root, "runtimes"), {
        hasNvidiaGpu: () => true
      });
      const gpu = service.list().whisperGpu;
      expect(gpu.supported).toBe(true);
      expect(gpu.bytes).toBeGreaterThan(0);
      expect(gpu.install.state).toBe("idle");
      service.dispose();
    });
  });

  /**
   * Detection resolves after the service is built, so the flag is read at call
   * time. Reading it once at construction would hide the offer until the next
   * launch on every machine.
   */
  it("picks up the GPU after hardware detection resolves", async () => {
    await withRoot((root) => {
      let detected = false;
      const service = createModelsService(root, join(root, "runtimes"), {
        hasNvidiaGpu: () => detected
      });
      expect(service.list().whisperGpu.supported).toBe(false);
      detected = true;
      expect(service.list().whisperGpu.supported).toBe(true);
      service.dispose();
    });
  });

  it("reports the GPU runtime as installed from what is on disk", async () => {
    await withRoot((root) => {
      const runtimeRoot = join(root, "runtimes");
      installRuntime(runtimeRoot, true);
      const service = createModelsService(root, runtimeRoot, { hasNvidiaGpu: () => true });
      expect(service.list().whisperGpu.install.state).toBe("done");
      service.dispose();
    });
  });

  it("leaves the GPU build alone when only the CPU runtime is installed", async () => {
    await withRoot((root) => {
      const runtimeRoot = join(root, "runtimes");
      installRuntime(runtimeRoot, false);
      const service = createModelsService(root, runtimeRoot, { hasNvidiaGpu: () => true });
      expect(service.list().whisperGpu.install.state).toBe("idle");
      service.dispose();
    });
  });

  it("never fetches the GPU build at boot", async () => {
    await withRoot((root) => {
      const runtimeRoot = join(root, "runtimes");
      installRuntime(runtimeRoot, false);
      let fetched = 0;
      const service = createModelsService(root, runtimeRoot, {
        hasNvidiaGpu: () => true,
        fetch: (() => {
          fetched += 1;
          throw new Error("should not fetch");
        }) as unknown as typeof fetch
      });
      service.ensureWhisperRuntime();
      expect(fetched).toBe(0);
      expect(service.list().whisperGpu.install.state).toBe("idle");
      service.dispose();
    });
  });

  it("waits for the boot-time CPU install before starting the CUDA install", async () => {
    await withRoot(async (root) => {
      const runtimeRoot = join(root, "runtimes");
      let releaseCpu!: () => void;
      let signalCpuFetch!: () => void;
      const cpuGate = new Promise<void>((resolve) => {
        releaseCpu = resolve;
      });
      const cpuFetchStarted = new Promise<void>((resolve) => {
        signalCpuFetch = resolve;
      });
      const urls: string[] = [];
      const service = createModelsService(root, runtimeRoot, {
        hasNvidiaGpu: () => true,
        fetch: (async (input: string | URL | Request) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          urls.push(url);
          if (url.includes("whisper-bin-x64.zip")) {
            signalCpuFetch();
            await cpuGate;
          }
          throw new Error("offline");
        }) as unknown as typeof fetch
      });

      const cpu = service.installWhisperRuntime();
      await cpuFetchStarted;
      const cuda = service.installWhisperGpuRuntime();
      await Promise.resolve();
      expect(urls).toHaveLength(1);

      releaseCpu();
      await Promise.all([cpu, cuda]);
      expect(urls).toHaveLength(2);
      expect(urls[1]).toContain("whisper-cublas-12.4.0-bin-x64.zip");
      service.dispose();
    });
  });

  it("records why a GPU install failed", async () => {
    await withRoot(async (root) => {
      const runtimeRoot = join(root, "runtimes");
      installRuntime(runtimeRoot, false);
      const service = createModelsService(root, runtimeRoot, {
        hasNvidiaGpu: () => true,
        fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch
      });
      await service.installWhisperGpuRuntime();
      const install = service.list().whisperGpu.install;
      expect(install.state).toBe("error");
      if (install.state === "error") {
        expect(install.message).toContain("offline");
      }
      service.dispose();
    });
  });
});
