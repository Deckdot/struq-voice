import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeDownloader, WHISPER_CLI_FILE } from "./runtime";
import {
  isCudaZipEntry,
  isRuntimeZipEntry,
  WHISPER_CUDA_LIBS,
  WHISPER_RUNTIME_LIBS
} from "./whisper-runtime-files";

/**
 * Unit tests for the whisper runtime downloader. The installed-state gates
 * need no network and no real zip; the full download/verify/extract path is
 * covered by e2e against the packaged app.
 */

let root: string;

const write = (root: string, name: string): void => {
  mkdirSync(join(root, "whisper-cpp"), { recursive: true });
  writeFileSync(join(root, "whisper-cpp", name), "fake");
};

/** Only the exe, which is what an install before this fix left behind. */
const installCliOnly = (root: string): void => {
  write(root, WHISPER_CLI_FILE);
};

const installRuntime = (root: string): void => {
  installCliOnly(root);
  for (const lib of WHISPER_RUNTIME_LIBS) {
    write(root, lib);
  }
  write(root, "ggml-cpu-haswell.dll");
};

const installCudaRuntime = (root: string): void => {
  installRuntime(root);
  for (const lib of WHISPER_CUDA_LIBS) {
    write(root, lib);
  }
};

describe("runtime downloader", () => {
  it("reports not installed when whisper-cli.exe is missing", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.isInstalled()).toBe(false);
  });

  it("reports installed when the whole runtime is present", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installRuntime(root);
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.isInstalled()).toBe(true);
    expect(downloader.missingFiles()).toEqual([]);
  });

  /**
   * The exe is dynamically linked, so an exe-only directory is a broken
   * install that used to look complete. It has to read as not installed or
   * install() short-circuits and the runtime is never repaired.
   */
  it("reports not installed when only whisper-cli.exe is present", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installCliOnly(root);
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.isInstalled()).toBe(false);
    expect(downloader.missingFiles()).toContain("whisper.dll");
  });

  it("reports not installed when no ggml CPU backend is present", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installCliOnly(root);
    for (const lib of WHISPER_RUNTIME_LIBS) {
      write(root, lib);
    }
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.isInstalled()).toBe(false);
    expect(downloader.missingFiles()).toContain("ggml-cpu-*.dll");
  });

  it("skips download when already installed", async () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installRuntime(root);
    const fetch = vi.fn(() => {
      throw new Error("should not be called");
    });
    const downloader = createRuntimeDownloader(root, { fetch });
    await expect(downloader.install()).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("repairs an exe-only install rather than skipping it", async () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installCliOnly(root);
    const fetch = vi.fn(() => Promise.reject(new Error("network reached")));
    const downloader = createRuntimeDownloader(root, { fetch });
    await expect(downloader.install()).rejects.toThrow("network reached");
    expect(fetch).toHaveBeenCalled();
  });
});

/**
 * The release zip carries the sample binaries too. Taking only whisper-cli.exe
 * was the original bug; taking everything would drag SDL2 and the parakeet
 * sample along for no reason.
 */
describe("runtime zip entries", () => {
  it("takes the cli and every whisper or ggml library", () => {
    for (const entry of [
      "Release/whisper-cli.exe",
      "Release/whisper.dll",
      "Release/ggml.dll",
      "Release/ggml-base.dll",
      "Release/ggml-cpu-haswell.dll"
    ]) {
      expect(isRuntimeZipEntry(entry)).toBe(true);
    }
  });

  it("leaves the sample binaries and their libraries behind", () => {
    for (const entry of [
      "Release/SDL2.dll",
      "Release/parakeet.dll",
      "Release/whisper-server.exe",
      "Release/main.exe",
      "Release/bench.exe"
    ]) {
      expect(isRuntimeZipEntry(entry)).toBe(false);
    }
  });

  it("adds the CUDA libraries for the cuBLAS asset", () => {
    for (const entry of [
      "Release/ggml-cuda.dll",
      "Release/cudart64_12.dll",
      "Release/cublas64_12.dll",
      "Release/cublasLt64_12.dll",
      "Release/whisper-cli.exe"
    ]) {
      expect(isCudaZipEntry(entry)).toBe(true);
    }
  });

  /**
   * The cuBLAS zip also carries nvrtc, nvblas and cuinj. Nothing in
   * whisper-cli's dependency chain imports them, and they are 50MB.
   */
  it("skips the CUDA extras nothing imports", () => {
    for (const entry of [
      "Release/nvrtc64_120_0.dll",
      "Release/nvrtc-builtins64_124.dll",
      "Release/nvblas64_12.dll",
      "Release/SDL2.dll"
    ]) {
      expect(isCudaZipEntry(entry)).toBe(false);
    }
  });
});

/**
 * The GPU build is the same runtime with the CUDA backend added, installed
 * into the same directory. It is 670MB, so nothing fetches it on its own.
 */
describe("cuda runtime", () => {
  it("reports the CPU runtime installed but the GPU one missing", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installRuntime(root);
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.isInstalled()).toBe(true);
    expect(downloader.isCudaInstalled()).toBe(false);
  });

  it("reports the GPU runtime installed once its libraries are present", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installCudaRuntime(root);
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.isCudaInstalled()).toBe(true);
  });

  it("treats a GPU install missing cuBLAS as not installed", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installRuntime(root);
    write(root, "ggml-cuda.dll");
    write(root, "cudart64_12.dll");
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.isCudaInstalled()).toBe(false);
  });

  /**
   * The CUDA build satisfies the CPU set, so the boot-time CPU install has
   * nothing to do. Without this it would fetch the 8MB zip and overwrite the
   * GPU build's DLLs with CPU-only ones from a different compilation.
   */
  it("does not re-install the CPU runtime over a GPU one", async () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installCudaRuntime(root);
    const fetch = vi.fn(() => {
      throw new Error("should not be called");
    });
    const downloader = createRuntimeDownloader(root, { fetch });
    await expect(downloader.install()).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips the GPU download when it is already installed", async () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installCudaRuntime(root);
    const fetch = vi.fn(() => {
      throw new Error("should not be called");
    });
    const downloader = createRuntimeDownloader(root, { fetch });
    await expect(downloader.installCuda()).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches the GPU build over a CPU-only install", async () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installRuntime(root);
    const fetch = vi.fn(() => Promise.reject(new Error("network reached")));
    const downloader = createRuntimeDownloader(root, { fetch });
    await expect(downloader.installCuda()).rejects.toThrow("network reached");
    expect(fetch).toHaveBeenCalled();
  });

  it("reports the GPU download size so the UI can warn about it", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.cudaBytesTotal()).toBeGreaterThan(downloader.bytesTotal());
  });
});
