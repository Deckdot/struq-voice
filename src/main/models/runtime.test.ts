import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeDownloader, WHISPER_CLI_FILE } from "./runtime";

/**
 * Unit tests for the whisper runtime downloader. The installed-state gates
 * need no network and no real zip; the full download/verify/extract path is
 * covered by e2e against the packaged app.
 */

let root: string;

const installCli = (root: string): void => {
  mkdirSync(join(root, "whisper-cpp"), { recursive: true });
  writeFileSync(join(root, "whisper-cpp", WHISPER_CLI_FILE), "fake");
};

describe("runtime downloader", () => {
  it("reports not installed when whisper-cli.exe is missing", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.isInstalled()).toBe(false);
  });

  it("reports installed when whisper-cli.exe exists", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installCli(root);
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    expect(downloader.isInstalled()).toBe(true);
  });

  it("skips download when already installed", async () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    installCli(root);
    const fetch = vi.fn(() => {
      throw new Error("should not be called");
    });
    const downloader = createRuntimeDownloader(root, { fetch });
    await expect(downloader.install()).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exposes onProgress subscription", () => {
    root = mkdtempSync(join(tmpdir(), "sv-rt-"));
    const downloader = createRuntimeDownloader(root, { fetch: globalThis.fetch });
    const listener = vi.fn();
    const unsubscribe = downloader.onProgress(listener);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });
});
