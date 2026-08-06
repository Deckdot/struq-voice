/**
 * Installs and verifies catalog models under `modelsRoot`. Verified files live
 * at `modelsRoot/<modelId>/<file.path>`, placed atomically by the downloader so
 * `verify` only needs read access. `isInstalled` is a fast existence probe,
 * `verify` recomputes a full sha256 per file (a 64-hex-zero placeholder hash
 * counts as verified), `delete` removes a model directory wholesale including
 * any `.partial` leftovers, and `totalDiskUsed` sums every file below the root.
 */

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ModelFile, ModelInfo } from "../../shared/models";

const ZERO_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export interface ModelInstaller {
  isInstalled: (model: ModelInfo) => boolean;
  verify: (model: ModelInfo) => Promise<boolean>;
  installedBytes: (model: ModelInfo) => number;
  delete: (model: ModelInfo) => Promise<void>;
  totalDiskUsed: () => number;
  readonly modelsRoot: string;
}

export const createModelInstaller = (modelsRoot: string): ModelInstaller => {
  const modelDir = (model: ModelInfo): string => join(modelsRoot, model.id);

  const hashFile = async (filePath: string): Promise<string> => {
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      createReadStream(filePath)
        .on("data", (chunk: string | Buffer) => {
          hash.update(chunk);
        })
        .on("error", reject)
        .on("end", resolve);
    });
    return hash.digest("hex");
  };

  const isInstalled = (model: ModelInfo): boolean =>
    model.files.every((file: ModelFile) => existsSync(join(modelDir(model), file.path)));

  const verify = async (model: ModelInfo): Promise<boolean> => {
    for (const file of model.files) {
      const stats = await stat(join(modelDir(model), file.path)).catch(() => null);
      if (stats === null || !stats.isFile()) {
        return false;
      }
      if (file.sha256 !== ZERO_HASH && (await hashFile(join(modelDir(model), file.path))) !== file.sha256) {
        return false;
      }
    }
    return true;
  };

  const installedBytes = (model: ModelInfo): number => {
    let total = 0;
    for (const file of model.files) {
      try {
        const stats = statSync(join(modelDir(model), file.path));
        if (stats.isFile()) {
          total += stats.size;
        }
      } catch {
        continue;
      }
    }
    return total;
  };

  const deleteModel = async (model: ModelInfo): Promise<void> => {
    // rm can hit EPERM/EBUSY when a scanner or an aborted download stream
    // still holds a file open. Retry briefly; a delete that visibly fails is
    // worse than one that takes half a second.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rm(modelDir(model), { recursive: true, force: true });
        return;
      } catch (error) {
        const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
        if (
          (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") ||
          attempt >= 5
        ) {
          throw error;
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 200 * attempt);
        });
      }
    }
  };

  const totalDiskUsed = (): number => {
    let entries: Dirent[];
    try {
      entries = readdirSync(modelsRoot, { recursive: true, withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return 0;
      }
      throw error;
    }
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      try {
        total += statSync(join(entry.parentPath, entry.name)).size;
      } catch {
        continue;
      }
    }
    return total;
  };

  return {
    isInstalled,
    verify,
    installedBytes,
    delete: deleteModel,
    totalDiskUsed,
    modelsRoot
  };
};
