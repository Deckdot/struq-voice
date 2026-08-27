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
  isCudaZipEntry,
  isRuntimeZipEntry,
  missingCudaFilesIn,
  missingCudaRuntimeFiles,
  missingRuntimeFilesIn,
  missingWhisperRuntimeFiles,
  whisperRuntimeDir,
  WHISPER_CLI_FILE,
  WHISPER_RUNTIME_DIR
} from "./whisper-runtime-files";

export { WHISPER_RUNTIME_DIR, WHISPER_CLI_FILE };

/** Which build of the runtime an install is fetching. */
export type WhisperRuntimeVariant = "cpu" | "cuda";

const RELEASE_ROOT =
  "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2";

interface RuntimeAsset {
  readonly url: string;
  readonly sha256: string;
  readonly zipBytes: number;
  /** Which zip entries this variant needs on disk. */
  readonly accepts: (fileName: string) => boolean;
  /** What the given directory is still missing for this variant. */
  readonly missingIn: (dir: string) => readonly string[];
  /** Hard ceiling on the whole install, scaled to the download size. */
  readonly timeoutMs: number;
}

/**
 * Both assets come from the same v1.9.2 release and are sha256 pinned.
 *
 * The 11.8 cuBLAS asset is deliberately not offered: its ggml-cuda.dll
 * imports cublas64_11.dll, which that zip does not ship, so the backend scan
 * skips it and the machine quietly decodes on the CPU while reporting a GPU
 * install. 12.4 carries every library it imports.
 */
const ASSETS: Record<WhisperRuntimeVariant, RuntimeAsset> = {
  cpu: {
    url: `${RELEASE_ROOT}/whisper-bin-x64.zip`,
    sha256: "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
    zipBytes: 8194445,
    accepts: isRuntimeZipEntry,
    missingIn: (dir) => missingRuntimeFilesIn(dir),
    // It is 8MB, so a slow proxy is a failure, not a lifestyle.
    timeoutMs: 120_000
  },
  cuda: {
    url: `${RELEASE_ROOT}/whisper-cublas-12.4.0-bin-x64.zip`,
    sha256: "443110ddaad70d4290ab2e77179e31cf712035bbc4fad56bb4519a90c917b39c",
    zipBytes: 670611449,
    accepts: isCudaZipEntry,
    missingIn: (dir) => missingCudaFilesIn(dir),
    // 670MB, and the ceiling covers the body as well as the response, so it
    // has to clear a slow domestic line. An hour is generous on purpose: a
    // download aborted at ninety percent is worse than one that took a while.
    timeoutMs: 3_600_000
  }
};

const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 200;

export interface RuntimeDeps {
  readonly fetch: typeof fetch;
}

export interface RuntimeDownloader {
  /** True when every file the CLI needs is present, not just the exe. */
  isInstalled: () => boolean;
  /** What the install is still missing; empty when it is complete. */
  missingFiles: () => readonly string[];
  /** True when the GPU backend and its libraries are installed too. */
  isCudaInstalled: () => boolean;
  /** Download and extract the CPU build; resolves when it is in place. */
  install: () => Promise<void>;
  /** Download and extract the CUDA build, replacing whatever is installed. */
  installCuda: () => Promise<void>;
  /** Latest known bytes for progress. */
  bytesTotal: () => number;
  /** Download size of the CUDA build, for a UI that has to warn about it. */
  cudaBytesTotal: () => number;
  /** Per-file progress callback for a progress UI. */
  onProgress: (
    listener: (received: number, total: number, variant: WhisperRuntimeVariant) => void
  ) => () => void;
}

export const createRuntimeDownloader = (
  runtimeRoot: string,
  deps: RuntimeDeps
): RuntimeDownloader => {
  const targetDir = whisperRuntimeDir(runtimeRoot);
  const listeners = new Set<
    (received: number, total: number, variant: WhisperRuntimeVariant) => void
  >();

  const emit = (
    received: number,
    total: number,
    variant: WhisperRuntimeVariant
  ): void => {
    for (const listener of listeners) {
      listener(received, total, variant);
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
  const extractRuntime = (
    zipPath: string,
    into: string,
    accepts: (fileName: string) => boolean
  ): Promise<void> =>
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
            if (!accepts(entry.fileName)) {
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

  const installVariant = async (variant: WhisperRuntimeVariant): Promise<void> => {
    const asset = ASSETS[variant];
    // An exe-only directory left by an older build reads as not installed, so
    // this repairs it instead of reporting success over a broken runtime. It
    // is also what stops a CPU install from overwriting a GPU one: the CUDA
    // build satisfies the CPU set, so there is nothing left to do.
    if (asset.missingIn(targetDir).length === 0) return;

    const zipPath = join(targetDir, `whisper-runtime-${variant}.zip`);
    const extractDir = join(targetDir, ".extract");
    await mkdir(targetDir, { recursive: true });
    // Clear anything a previous failed attempt left behind, so a retry never
    // appends to a truncated zip or trips over a stale extract.
    await rm(zipPath, { force: true });
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });

    try {
      const response = await deps.fetch(asset.url, {
        signal: AbortSignal.timeout(asset.timeoutMs)
      });
      if (!response.ok || response.body === null) {
        throw new Error(`whisper runtime download failed: HTTP ${String(response.status)}`);
      }

      const headerTotal = Number(response.headers.get("content-length") ?? "0");
      const total = headerTotal > 0 ? headerTotal : asset.zipBytes;
      let received = 0;
      const body = response.body;

      // pipeline honours backpressure and destroys both ends on failure.
      // Writing straight from the read loop buffers the whole zip in memory
      // and leaves the stream dangling when something throws. That mattered
      // little at 8MB and would be fatal at 670MB.
      await pipeline(
        (async function* emitAsRead(): AsyncGenerator<Uint8Array> {
          const reader = body.getReader();
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            received += chunk.value.byteLength;
            emit(received, total, variant);
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
      if (hash.digest("hex") !== asset.sha256) {
        throw new Error("whisper runtime download failed verification; retry.");
      }

      await extractRuntime(zipPath, extractDir, asset.accepts);

      // Judge the staging area before publishing it. A zip that no longer
      // carried a CPU backend would otherwise install an exe that starts and
      // then aborts on the first decode, which is far harder to diagnose than
      // a failed install. For the GPU build the same check catches a missing
      // cuBLAS, which would otherwise install as a GPU runtime that quietly
      // decodes on the CPU.
      const missing = asset.missingIn(extractDir);
      if (missing.length > 0) {
        throw new Error(
          `whisper runtime zip is missing ${missing.join(", ")}; retry the install.`
        );
      }

      // Move the runtime into place. rename replaces an existing file on
      // Windows, so this also overwrites a half-installed directory, and the
      // CUDA build overwrites every CPU-build DLL with its own so the
      // directory never ends up holding halves of two different builds.
      for (const name of await readdir(extractDir)) {
        await renameWithRetry(join(extractDir, name), join(targetDir, name));
      }
      emit(1, 1, variant);
    } finally {
      // The GPU zip is 670MB and its extract is larger again. Leaving either
      // behind after a failure would cost more disk than the runtime itself.
      await rm(zipPath, { force: true });
      await rm(extractDir, { recursive: true, force: true });
    }
  };

  return {
    isInstalled: () => missingWhisperRuntimeFiles(runtimeRoot).length === 0,
    missingFiles: () => missingWhisperRuntimeFiles(runtimeRoot),
    isCudaInstalled: () => missingCudaRuntimeFiles(runtimeRoot).length === 0,
    bytesTotal: () => ASSETS.cpu.zipBytes,
    cudaBytesTotal: () => ASSETS.cuda.zipBytes,
    install: () => installVariant("cpu"),
    installCuda: () => installVariant("cuda"),
    onProgress: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};
