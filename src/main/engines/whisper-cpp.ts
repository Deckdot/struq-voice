/**
 * The whisper.cpp local engine: a sidecar process rather than a Node
 * binding, so a crash inside the model cannot take down the app and
 * swapping in a faster GPU build is trivial. Audio travels through a
 * temp WAV file; the transcript comes back as JSON on stdout.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result, VoiceError, VoiceErrorCode } from "../../shared/result";
import { fail, ok } from "../../shared/result";
import type {
  EngineReadiness,
  TranscribeRequest,
  TranscribeResult,
  TranscriptionEngine
} from "./types";

export const WHISPER_CPP_ENGINE_ID = "whisper-cpp" as const;

const DEFAULT_MODEL_ID = "whisper-large-v3-turbo-q5_0";
const DEFAULT_MODEL_FILE = "ggml-large-v3-turbo-q5_0.bin";
const CUDA_DLL = "cudart64_13.dll";
const SAMPLE_RATE = 16_000;
const EXEC_TIMEOUT_MS = 60_000;

const NOT_INSTALLED_MESSAGE =
  "Whisper runtime is not installed. Download it in Settings > Models.";
const NOT_DOWNLOADED_MESSAGE =
  "Whisper model is not downloaded. Download it in Settings > Models.";

const execFileAsync = promisify(execFile);

type ExecFileResult = { stdout: string; stderr: string };

export interface WhisperCppDeps {
  readonly execFile?: (
    command: string,
    args: readonly string[],
    opts: object
  ) => Promise<ExecFileResult>;
  readonly writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  readonly unlink?: (path: string) => Promise<void>;
  readonly exists?: (path: string) => boolean;
  readonly detectCuda?: () => Promise<"cuda" | "cpu">;
}

export interface WhisperCppEngineOptions {
  /** userData/runtimes; whisper-cli.exe lives under whisper-cpp/. */
  readonly runtimeRoot: string;
  /** userData/models; the catalog model downloads here. */
  readonly modelsRoot: string;
  /** Catalog id of the whisper model; defaults to whisper-large-v3-turbo-q5_0. */
  readonly modelId?: string;
  readonly onWarmup?: (state: "cold" | "warming" | "warm" | "failed") => void;
  readonly deps?: WhisperCppDeps;
}

const whisperFailure = (message: string): VoiceError => {
  const error: {
    readonly code: VoiceErrorCode;
    readonly message: string;
    readonly recoverable: boolean;
  } = {
    code: "WHISPER_CPP" as VoiceErrorCode,
    message,
    recoverable: true
  };
  return error;
};

/**
 * Build a 16kHz mono 16-bit PCM WAV in memory. 44-byte header, little
 * endian. whisper.cpp reads this directly.
 */
const buildWav = (pcm: Int16Array): Buffer => {
  const dataSize = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) {
    buffer.writeInt16LE(pcm[i] ?? 0, 44 + i * 2);
  }
  return buffer;
};

/** Extract the transcript from whisper-cli --output-json stdout. */
const parseTranscript = (stdout: string): string => {
  try {
    const payload = JSON.parse(stdout) as {
      text?: string;
      segments?: Array<{ text?: string }>;
    };
    if (typeof payload.text === "string" && payload.text.length > 0) {
      return payload.text;
    }
    if (Array.isArray(payload.segments)) {
      return payload.segments
        .map((segment) => segment.text ?? "")
        .join(" ")
        .trim();
    }
  } catch {
    // Fall through: the output was not the expected JSON shape.
  }
  return stdout.trim();
};

export const createWhisperCppEngine = (
  options: WhisperCppEngineOptions
): TranscriptionEngine => {
  let cudaCache: "cuda" | "cpu" | null = null;

  const exec = options.deps?.execFile ?? execFileAsync;
  const writeAudio = options.deps?.writeFile ?? writeFile;
  const removeFile = options.deps?.unlink ?? unlink;
  const fileExists = options.deps?.exists ?? existsSync;

  const binaryPath = join(options.runtimeRoot, "whisper-cpp", "whisper-cli.exe");
  // The model lives in the catalog download tree: modelsRoot/<modelId>/<file>.
  // Defaults to the whisper-large-v3-turbo-q5_0 entry.
  const modelId = options.modelId ?? DEFAULT_MODEL_ID;
  const modelPath = join(options.modelsRoot, modelId, DEFAULT_MODEL_FILE);

  const detectCuda = async (): Promise<"cuda" | "cpu"> => {
    if (cudaCache !== null) return cudaCache;
    const detect = options.deps?.detectCuda;
    cudaCache = detect !== undefined ? await detect() : fileExists(join(options.runtimeRoot, "whisper-cpp", CUDA_DLL)) ? "cuda" : "cpu";
    return cudaCache;
  };

  const computeReadiness = (): EngineReadiness => {
    if (!fileExists(binaryPath)) {
      return { ready: false, reason: NOT_INSTALLED_MESSAGE, action: "install-runtime" };
    }
    if (!fileExists(modelPath)) {
      return { ready: false, reason: NOT_DOWNLOADED_MESSAGE, action: "download-model" };
    }
    return { ready: true };
  };

  return {
    id: WHISPER_CPP_ENGINE_ID,
    displayName: "Whisper.cpp",
    kind: "local",
    readiness: (): Promise<EngineReadiness> =>
      Promise.resolve(computeReadiness()),
    warmup: (): Promise<void> => {
      options.onWarmup?.(computeReadiness().ready ? "warm" : "failed");
      return Promise.resolve();
    },
    transcribe: (
      request: TranscribeRequest
    ): Promise<Result<TranscribeResult>> => {
      const tempWav = join(
        tmpdir(),
        `struq-voice-whisper-${String(Date.now())}-${Math.random().toString(36).slice(2)}.wav`
      );
      const startedAt = Date.now();
      return (async () => {
        try {
          await writeAudio(tempWav, buildWav(request.pcm));

          const args: string[] = [
            "-m", modelPath,
            "-f", tempWav,
            "-t", "8",
            "--output-json",
            "--no-timestamps"
          ];
          if (request.language !== undefined) {
            args.push("-l", request.language);
          } else {
            args.push("-l", "auto");
          }
          const gpu = await detectCuda();
          if (gpu === "cpu") {
            args.push("--no-gpu");
          }

          const { stdout } = await exec(binaryPath, args, {
            timeout: EXEC_TIMEOUT_MS,
            windowsHide: true
          });
          const inferenceMs = Date.now() - startedAt;
          return ok({
            text: parseTranscript(stdout),
            language: request.language ?? null,
            engineId: WHISPER_CPP_ENGINE_ID,
            modelId: DEFAULT_MODEL_FILE,
            inferenceMs,
            realtimeFactor: inferenceMs / Math.max(request.durationMs, 1),
            costUsd: null
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return fail(whisperFailure(message));
        } finally {
          await removeFile(tempWav).catch(() => {});
        }
      })();
    },
    dispose: (): Promise<void> => Promise.resolve()
  };
};
