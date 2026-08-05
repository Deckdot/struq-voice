/**
 * Whisper.cpp runtime download: the whisper-cli.exe binary. Ships as a zip
 * on the ggml-org/whisper.cpp release; this module downloads it (sha256
 * verified) and extracts whisper-cli.exe into runtimeRoot/whisper-cpp/.
 *
 * The catalog downloader handles model files; the runtime is a separate,
 * one-file concept so it lives here. The CPU build is the default: it works
 * on any Windows machine and the engine reports CPU fallback clearly.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import * as yauzl from "yauzl";

export const WHISPER_RUNTIME_DIR = "whisper-cpp";
export const WHISPER_CLI_FILE = "whisper-cli.exe";

/** CPU build, verified against the v1.9.2 release. */
const RUNTIME_URL =
  "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip";
const RUNTIME_SHA256 =
  "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a";

export interface RuntimeDeps {
  readonly fetch: typeof fetch;
}

export interface RuntimeDownloader {
  /** True when whisper-cli.exe exists. */
  isInstalled: () => boolean;
  /** Download and extract; resolves when whisper-cli.exe is in place. */
  install: () => Promise<void>;
  /** Latest known bytes for progress. */
  bytesTotal: () => number;
  /** Per-file progress callback for a progress UI. */
  onProgress: (listener: (received: number, total: number) => void) => () => void;
}

export const createRuntimeDownloader = (
  runtimeRoot: string,
  deps: RuntimeDeps
): RuntimeDownloader => {
  const cliPath = join(runtimeRoot, WHISPER_RUNTIME_DIR, WHISPER_CLI_FILE);
  const listeners = new Set<(received: number, total: number) => void>();

  const emit = (received: number, total: number): void => {
    for (const listener of listeners) {
      listener(received, total);
    }
  };

  return {
    isInstalled: () => existsSync(cliPath),
    bytesTotal: () => 8194445,
    install: async () => {
      if (existsSync(cliPath)) return;

      const zipPath = join(runtimeRoot, WHISPER_RUNTIME_DIR, "whisper-bin-x64.zip");
      const extractDir = join(runtimeRoot, WHISPER_RUNTIME_DIR, ".extract");
      await mkdir(join(runtimeRoot, WHISPER_RUNTIME_DIR), { recursive: true });
      await mkdir(extractDir, { recursive: true });

      const response = await deps.fetch(RUNTIME_URL);
      if (!response.ok || response.body === null) {
        throw new Error(`whisper runtime download failed: HTTP ${String(response.status)}`);
      }

      const headerTotal = Number(response.headers.get("content-length") ?? "0");
      const total = headerTotal > 0 ? headerTotal : 8194445;
      let received = 0;
      const writer = createWriteStream(zipPath);
      const reader = response.body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value.byteLength;
          writer.write(chunk.value);
          emit(received, total);
        }
        await new Promise<void>((resolve, reject) => {
          writer.on("error", reject);
          writer.end(() => {
            resolve();
          });
        });
      } catch (error) {
        writer.destroy();
        throw error;
      }

      // sha256 verify the zip before touching anything else.
      const hash = createHash("sha256");
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(zipPath);
        stream.on("data", (chunk: string | Buffer) => {
          hash.update(chunk);
        });
        stream.on("end", () => {
          resolve();
        });
        stream.on("error", reject);
      });
      if (hash.digest("hex") !== RUNTIME_SHA256) {
        await rm(zipPath, { force: true });
        throw new Error("whisper runtime download failed verification; retry.");
      }

      // Extract only whisper-cli.exe. yauzl reads the central directory.
      await new Promise<void>((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (openError: Error | null, zipfile?: yauzl.ZipFile) => {
          if (openError !== null || zipfile === undefined) {
            reject(openError ?? new Error("could not open runtime zip"));
            return;
          }
          zipfile.on("error", reject);
          zipfile.on("close", () => {
            void readdir(extractDir).then(() => {
              resolve();
            });
          });
          zipfile.on("entry", (entry: yauzl.Entry) => {
            if (entry.fileName.endsWith(WHISPER_CLI_FILE)) {
              zipfile.openReadStream(entry, (readError: Error | null, readStream?: NodeJS.ReadableStream) => {
                if (readError !== null || readStream === undefined) {
                  reject(readError ?? new Error("could not open runtime entry"));
                  return;
                }
                const baseName = entry.fileName.split("/").pop();
                const target = join(extractDir, baseName ?? WHISPER_CLI_FILE);
                const out = createWriteStream(target);
                readStream.pipe(out);
                out.on("close", () => {
                  zipfile.readEntry();
                });
                out.on("error", (error: Error) => {
                  reject(error);
                });
              });
            } else {
              zipfile.readEntry();
            }
          });
        });
      });

      // Move whisper-cli.exe into place and clean up.
      const extracted = join(extractDir, WHISPER_CLI_FILE);
      await rename(extracted, cliPath);
      await rm(zipPath, { force: true });
      await rm(extractDir, { recursive: true, force: true });
      emit(1, 1);
    },
    onProgress: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};
