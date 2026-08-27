import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeDownloader, WHISPER_CLI_FILE } from "./runtime";
import {
  isRuntimeZipEntry,
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
});
