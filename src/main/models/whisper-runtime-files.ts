/**
 * The layout of the whisper.cpp runtime directory: which files have to be on
 * disk before whisper-cli.exe can decode anything.
 *
 * whisper-cli.exe is dynamically linked, so on its own it is inert. With no
 * DLLs beside it Windows refuses to start the process at all (0xC0000135,
 * STATUS_DLL_NOT_FOUND), and Node reports that as a bare
 * "Command failed: <path>" with empty stderr, which is what a user sees when
 * they pick a whisper model. With only its import-table DLLs it gets further,
 * loads the model, then aborts on GGML_ASSERT(device): ggml discovers its CPU
 * backend by scanning this directory for a ggml-cpu-*.dll at runtime, so a
 * backend variant has to be present too.
 *
 * The runtime is therefore a set of files rather than one binary, and both the
 * installer and the engine's readiness check judge it as a set.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export const WHISPER_RUNTIME_DIR = "whisper-cpp";
export const WHISPER_CLI_FILE = "whisper-cli.exe";

/** Named in whisper-cli.exe's import table; the process cannot start without them. */
export const WHISPER_RUNTIME_LIBS: readonly string[] = [
  "whisper.dll",
  "ggml.dll",
  "ggml-base.dll"
];

/**
 * The interchangeable CPU backends ggml loads at runtime. It picks the best
 * one the processor supports, so any single one of these makes the runtime
 * usable. Listing them by name rather than globbing the directory keeps the
 * check on the injected `exists` the engine already has, and one of them
 * missing from a future release is then not a false "runtime broken".
 */
export const WHISPER_CPU_BACKENDS: readonly string[] = [
  "ggml-cpu.dll",
  "ggml-cpu-x64.dll",
  "ggml-cpu-sse42.dll",
  "ggml-cpu-sandybridge.dll",
  "ggml-cpu-haswell.dll",
  "ggml-cpu-skylakex.dll",
  "ggml-cpu-icelake.dll",
  "ggml-cpu-cascadelake.dll",
  "ggml-cpu-cannonlake.dll",
  "ggml-cpu-alderlake.dll"
];

/** Stand-in name reported when no CPU backend at all is on disk. */
export const CPU_BACKEND_LABEL = "ggml-cpu-*.dll";

/**
 * The CUDA backend, layered on top of the same directory. ggml-cuda.dll is
 * loaded by the same runtime scan that finds the CPU backends, and it imports
 * cudart and cuBLAS by name, so all four have to be present or the scan skips
 * it and decoding silently stays on the CPU.
 *
 * The names carry the CUDA major version, which is why they are pinned rather
 * than globbed: the 12.4 release asset is the one we install, and a directory
 * holding some other major version's libraries is not a runtime this build can
 * use. nvcuda.dll is the driver's own and never ships with the app.
 */
export const WHISPER_CUDA_LIBS: readonly string[] = [
  "ggml-cuda.dll",
  "cudart64_12.dll",
  "cublas64_12.dll",
  "cublasLt64_12.dll"
];

/** runtimeRoot/whisper-cpp, where the installer puts every runtime file. */
export const whisperRuntimeDir = (runtimeRoot: string): string =>
  join(runtimeRoot, WHISPER_RUNTIME_DIR);

/** runtimeRoot/whisper-cpp/whisper-cli.exe, the binary the engine spawns. */
export const whisperCliPath = (runtimeRoot: string): string =>
  join(whisperRuntimeDir(runtimeRoot), WHISPER_CLI_FILE);

/**
 * What the given directory is still missing, empty when the runtime is
 * complete. Takes a directory rather than the runtime root so the installer
 * can check its staging area with the same rules it will apply afterwards.
 */
export const missingRuntimeFilesIn = (
  dir: string,
  exists: (path: string) => boolean = existsSync
): readonly string[] => {
  const missing: string[] = [];
  for (const name of [WHISPER_CLI_FILE, ...WHISPER_RUNTIME_LIBS]) {
    if (!exists(join(dir, name))) {
      missing.push(name);
    }
  }
  if (!WHISPER_CPU_BACKENDS.some((name) => exists(join(dir, name)))) {
    missing.push(CPU_BACKEND_LABEL);
  }
  return missing;
};

/** As missingRuntimeFilesIn, addressed by runtime root. */
export const missingWhisperRuntimeFiles = (
  runtimeRoot: string,
  exists: (path: string) => boolean = existsSync
): readonly string[] => missingRuntimeFilesIn(whisperRuntimeDir(runtimeRoot), exists);

/** What the GPU backend is missing from the given directory, empty when whole. */
export const missingCudaFilesIn = (
  dir: string,
  exists: (path: string) => boolean = existsSync
): readonly string[] => [
  ...missingRuntimeFilesIn(dir, exists),
  ...WHISPER_CUDA_LIBS.filter((name) => !exists(join(dir, name)))
];

/** As missingCudaFilesIn, addressed by runtime root. */
export const missingCudaRuntimeFiles = (
  runtimeRoot: string,
  exists: (path: string) => boolean = existsSync
): readonly string[] => missingCudaFilesIn(whisperRuntimeDir(runtimeRoot), exists);

/**
 * Whether the whisper.cpp CUDA backend sits next to whisper-cli.exe. The
 * presence of these files is the only GPU signal this app has, so hardware
 * detection reads it from here rather than probing for it a second time.
 *
 * This used to look for cudart64_13.dll, a name that appears in no release
 * asset we install, so it was answering "no GPU" unconditionally.
 */
export const hasCudaRuntime = (
  runtimeRoot: string,
  exists: (path: string) => boolean = existsSync
): boolean => missingCudaRuntimeFiles(runtimeRoot, exists).length === 0;

/**
 * Whether a zip entry is a file the whisper CLI needs. Matched on the trailing
 * name because the release zip nests everything under Release/. SDL2.dll and
 * parakeet.dll are in that zip too and belong to the other sample binaries, so
 * they are deliberately not included.
 */
export const isRuntimeZipEntry = (fileName: string): boolean => {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  if (base === WHISPER_CLI_FILE) return true;
  return /^(?:whisper|ggml)[^/\\]*\.dll$/i.test(base);
};

/**
 * As isRuntimeZipEntry, for the cuBLAS asset. That zip is a superset build:
 * the same exe and ggml CPU backends compiled with CUDA support, plus the GPU
 * backend and its libraries. Installing it therefore replaces the whole
 * directory rather than layering onto a CPU install, which keeps every DLL
 * from one build instead of mixing two.
 *
 * It also carries nvrtc, nvblas and cuinj, which nothing in whisper-cli's
 * dependency chain imports, so those are left in the zip.
 */
export const isCudaZipEntry = (fileName: string): boolean => {
  if (isRuntimeZipEntry(fileName)) return true;
  const base = fileName.split(/[/\\]/).pop() ?? "";
  return WHISPER_CUDA_LIBS.includes(base);
};
