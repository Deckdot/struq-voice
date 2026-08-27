/**
 * Whisper.cpp runtime download. The binary ships as a zip on the
 * ggml-org/whisper.cpp release; this module downloads it (sha256 verified) and
 * extracts the runtime into runtimeRoot/whisper-cpp/.
 *
 * "The runtime" is whisper-cli.exe plus the DLLs it links against and the ggml
 * CPU backend it loads at runtime, not the exe alone. Extracting only the exe
 * produced an install that looked complete to every check in the app and then
 * failed on first use with a bare "Command failed: <path>", because Windows
 * could not start the process at all. See whisper-runtime-files.ts for the set.
 *
 * The catalog downloader handles model files; the runtime is a separate
 * concept so it lives here. The CPU build is the default: it works on any
 * Windows machine and the engine reports CPU fallback clearly.
 *
 * The download runs under a hard total timeout (the zip is 8MB, so a slow
 * proxy is a failure, not a lifestyle), and the final rename retries the
 * EPERM a scanner can throw on a freshly written exe.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import {
  isRuntimeZipEntry,
  missingRuntimeFilesIn,
  missingWhisperRuntimeFiles,
  whisperRuntimeDir,
  WHISPER_CLI_FILE,
  WHISPER_RUNTIME_DIR
} from "./whisper-runtime-files";

export { WHISPER_RUNTIME_DIR, WHISPER_CLI_FILE };

/** CPU build, verified against the v1.9.2 release. */
const RUNTIME_URL =
  "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip";
const RUNTIME_SHA256 =
  "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a";
/** The whole runtime install must finish within this; it is 8MB. */
const RUNTIME_TIMEOUT_MS = 120_000;
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 200;
const RUNTIME_ZIP_BYTES = 8194445;

export interface RuntimeDeps {
  readonly fetch: typeof fetch;
}

export interface RuntimeDownloader {
  /** True when every file the CLI needs is present, not just the exe. */
  isInstalled: () => boolean;
  /** What the install is still missing; empty when it is complete. */
  missingFiles: () => readonly string[];
  /** Download and extract; resolves when the runtime is in place. */
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
  const targetDir = whisperRuntimeDir(runtimeRoot);
  const listeners = new Set<(received: number, total: number) => void>();

  const emit = (received: number, total: number): void => {
    for (const listener of listeners) {
      listener(received, total);
    }
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  /** Scanner-held exe files fail the one-shot rename; retry before giving up. */
  const renameWithRetry = async (from: string, to: string): Promise<void> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(from, to);
        return;
      } catch (error) {
        const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
        if (
          (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") ||
          attempt >= RENAME_ATTEMPTS
        ) {
          throw error;
        }
        await sleep(RENAME_RETRY_DELAY_MS * attempt);
      }
    }
  };

  /**
   * Pull every runtime file out of the zip into `into`. yauzl reads the
   * central directory. With lazyEntries the first entry is only emitted after
   * an explicit readEntry(); without that initial call nothing is ever
   * emitted, the zipfile never closes and the install hangs at 100 percent.
   */
  const extractRuntime = (zipPath: string, into: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      yauzl.open(
        zipPath,
        { lazyEntries: true },
        (openError: Error | null, zipfile?: yauzl.ZipFile) => {
          if (openError !== null || zipfile === undefined) {
            reject(openError ?? new Error("could not open runtime zip"));
            return;
          }
          zipfile.on("error", reject);
          zipfile.on("close", () => {
            resolve();
          });
          zipfile.on("entry", (entry: yauzl.Entry) => {
            // Everything sits under a Release/ directory in the release zip,
            // so entries are matched on the trailing name, not the full path.
            if (!isRuntimeZipEntry(entry.fileName)) {
              zipfile.readEntry();
              return;
            }
            zipfile.openReadStream(
              entry,
              (readError: Error | null, readStream?: NodeJS.ReadableStream) => {
                if (readError !== null || readStream === undefined) {
                  reject(readError ?? new Error("could not open runtime entry"));
                  return;
                }
                const name = entry.fileName.split(/[/\\]/).pop() ?? entry.fileName;
                const out = createWriteStream(join(into, name));
                readStream.on("error", reject);
                out.on("error", reject);
                out.on("close", () => {
                  zipfile.readEntry();
                });
                readStream.pipe(out);
              }
            );
          });
          zipfile.readEntry();
        }
      );
    });

  return {
    isInstalled: () => missingWhisperRuntimeFiles(runtimeRoot).length === 0,
    missingFiles: () => missingWhisperRuntimeFiles(runtimeRoot),
    bytesTotal: () => RUNTIME_ZIP_BYTES,
    install: async () => {
      // An exe-only directory left by an older build reads as not installed,
      // so this repairs it instead of reporting success over a broken runtime.
      if (missingWhisperRuntimeFiles(runtimeRoot).length === 0) return;

      const zipPath = join(targetDir, "whisper-bin-x64.zip");
      const extractDir = join(targetDir, ".extract");
      await mkdir(targetDir, { recursive: true });
      // Clear anything a previous failed attempt left behind, so a retry never
      // appends to a truncated zip or trips over a stale extract.
      await rm(zipPath, { force: true });
      await rm(extractDir, { recursive: true, force: true });
      await mkdir(extractDir, { recursive: true });

      const response = await deps.fetch(RUNTIME_URL, {
        signal: AbortSignal.timeout(RUNTIME_TIMEOUT_MS)
      });
      if (!response.ok || response.body === null) {
        throw new Error(`whisper runtime download failed: HTTP ${String(response.status)}`);
      }

      const headerTotal = Number(response.headers.get("content-length") ?? "0");
      const total = headerTotal > 0 ? headerTotal : RUNTIME_ZIP_BYTES;
      let received = 0;
      const body = response.body;

      // pipeline honours backpressure and destroys both ends on failure.
      // Writing straight from the read loop buffers the whole zip in memory
      // and leaves the stream dangling when something throws.
      await pipeline(
        (async function* emitAsRead(): AsyncGenerator<Uint8Array> {
          const reader = body.getReader();
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            received += chunk.value.byteLength;
            emit(received, total);
            yield chunk.value;
          }
        })(),
        createWriteStream(zipPath)
      );

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

      await extractRuntime(zipPath, extractDir);

      // Judge the staging area before publishing it. A zip that no longer
      // carried a CPU backend would otherwise install an exe that starts and
      // then aborts on the first decode, which is far harder to diagnose than
      // a failed install.
      const missing = missingRuntimeFilesIn(extractDir);
      if (missing.length > 0) {
        await rm(zipPath, { force: true });
        await rm(extractDir, { recursive: true, force: true });
        throw new Error(
          `whisper runtime zip is missing ${missing.join(", ")}; retry the install.`
        );
      }

      // Move the runtime into place and clean up. rename replaces an existing
      // file on Windows, so this also overwrites a half-installed directory.
      for (const name of await readdir(extractDir)) {
        await renameWithRetry(join(extractDir, name), join(targetDir, name));
      }
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
