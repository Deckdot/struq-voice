/**
 * Tests for the model installer. Uses real files in a temp directory and
 * covers the existence probe, sha256 verification (including zero-hash
 * acceptance), byte accounting, model deletion and total disk usage.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelFile, ModelInfo } from "../../shared/models";
import { createModelInstaller } from "./installer";

const ZERO_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const makeFile = (path: string, content: string, hash?: string): ModelFile => ({
  path,
  url: `https://example.test/${path}`,
  bytes: Buffer.byteLength(content),
  sha256: hash ?? sha256(content)
});

let modelCounter = 0;

const makeModel = (files: readonly ModelFile[]): ModelInfo => {
  modelCounter += 1;
  return {
    id: `test-model-${String(modelCounter)}`,
    name: "Test Model",
    engine: "parakeet",
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    languages: "Test",
    whenToUse: "Test",
    license: "Apache 2.0",
    files
  };
};

const installFile = (root: string, model: ModelInfo, file: ModelFile, content: string): void => {
  const target = join(root, model.id, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
};

const withRoot = async (fn: (root: string) => void | Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "sv-inst-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("model installer", () => {
  it("reports installed only when every file is present", () =>
    withRoot((root) => {
      const model = makeModel([
        makeFile("encoder.bin", "enc"),
        makeFile("decoder.bin", "dec")
      ]);
      const installer = createModelInstaller(root);

      expect(installer.isInstalled(model)).toBe(false);

      installFile(root, model, model.files[0]!, "enc");
      expect(installer.isInstalled(model)).toBe(false);

      installFile(root, model, model.files[1]!, "dec");
      expect(installer.isInstalled(model)).toBe(true);
    }));


  it("verifies correct content, rejects a corrupted file and accepts zero-hash files", async () => {
    await withRoot(async (root) => {
      const model = makeModel([
        makeFile("payload.bin", "correct-content"),
        makeFile("tokens.txt", "whatever", ZERO_HASH)
      ]);
      const installer = createModelInstaller(root);

      installFile(root, model, model.files[0]!, "correct-content");
      installFile(root, model, model.files[1]!, "any-content-at-all");
      expect(await installer.verify(model)).toBe(true);

      installFile(root, model, model.files[0]!, "corrupted-content");
      expect(await installer.verify(model)).toBe(false);
    });
  });

  it("sums the bytes of the files that exist", () =>
    withRoot((root) => {
      const model = makeModel([
        makeFile("a.bin", "1234567890"),
        makeFile("b.bin", "12345678901234567890")
      ]);
      const installer = createModelInstaller(root);

      expect(installer.installedBytes(model)).toBe(0);

      installFile(root, model, model.files[0]!, "1234567890");
      expect(installer.installedBytes(model)).toBe(10);

      installFile(root, model, model.files[1]!, "12345678901234567890");
      expect(installer.installedBytes(model)).toBe(30);
    }));


  it("removes the whole model directory on delete", async () => {
    await withRoot(async (root) => {
      const model = makeModel([makeFile("a.bin", "hello")]);
      const installer = createModelInstaller(root);

      installFile(root, model, model.files[0]!, "hello");
      expect(installer.isInstalled(model)).toBe(true);

      await installer.delete(model);

      expect(installer.isInstalled(model)).toBe(false);
      expect(existsSync(join(root, model.id))).toBe(false);
    });
  });

  it("sums disk usage across model directories and returns zero on a missing root", () =>
    withRoot((root) => {
      const first = makeModel([makeFile("a.bin", "12345"), makeFile("b.bin", "67890")]);
      const second = makeModel([makeFile("c.bin", "123")]);
      const installer = createModelInstaller(root);

      expect(installer.totalDiskUsed()).toBe(0);

      installFile(root, first, first.files[0]!, "12345");
      installFile(root, first, first.files[1]!, "67890");
      installFile(root, second, second.files[0]!, "123");

      expect(installer.totalDiskUsed()).toBe(13);

      const absent = createModelInstaller(join(root, "does-not-exist"));
      expect(absent.totalDiskUsed()).toBe(0);
    }));

});
