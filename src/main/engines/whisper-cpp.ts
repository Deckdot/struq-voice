/**
 * The whisper.cpp local engine: a sidecar process rather than a Node
 * binding, so a crash inside the model cannot take down the app and
 * swapping in a faster GPU build is trivial. Audio travels through a
 * temp WAV file; the transcript comes back as JSON on stdout.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findModel } from "../../shared/models";
import { transcribeTimeoutMs } from "./timeouts";
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
  readonly readFile?: (path: string) => Promise<string>;
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
  /**
   * Read the selected model id at call time. Takes precedence over modelId so
   * changing the model in Settings applies without rebuilding the engine.
   */
  readonly getModelId?: () => string;
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

/**
 * Whisper labels what it hears but cannot transcribe: `[BLANK_AUDIO]` for a
 * silent stretch, `[MUSIC]`, `*laughs*`, and parenthesised room noise. Those
 * are notes about the recording, not words the user said, and pasting them
 * into a document is the single most visible whisper glitch. Only a
 * parenthesised group that is the whole of what a segment says is dropped,
 * because parentheses do occur in real dictation and bracket marks do not.
 */
const stripNonSpeech = (text: string): string =>
  text
    .replace(/\[[^\]\n]{0,60}\]/g, " ")
    .replace(/\*[^*\n]{0,60}\*/g, " ")
    .replace(/^\s*\([^)\n]{0,60}\)\s*$/gm, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();

interface WhisperJson {
  readonly result?: { readonly language?: string };
  readonly transcription?: ReadonlyArray<{ readonly text?: string }>;
}

/**
 * whisper-cli's `--output-json` file, which is the only place the run reports
 * the language it actually decoded in. Reading the transcript from stdout
 * instead meant history and post-processing believed every whisper capture
 * was in whatever language the settings named, and English whenever that was
 * "auto".
 */
const parseWhisperJson = (
  raw: string
): { text: string; language: string | null } | null => {
  try {
    const payload = JSON.parse(raw) as WhisperJson;
    const segments = payload.transcription;
    if (segments === undefined) return null;
    const text = stripNonSpeech(
      segments.map((segment) => segment.text ?? "").join("")
    );
    const language = payload.result?.language ?? null;
    return { text, language: language !== null && language.length > 0 ? language : null };
  } catch {
    return null;
  }
};

/** Last resort when the JSON side file is missing or unreadable. */
const parseTranscript = (stdout: string): string => stripNonSpeech(stdout);

/**
 * Whether the whisper.cpp CUDA runtime sits next to whisper-cli.exe. The
 * presence of the DLL is the only GPU signal this app has, so hardware
 * detection reads it from here rather than probing for it a second time.
 */
export const hasCudaRuntime = (
  runtimeRoot: string,
  exists: (path: string) => boolean = existsSync
): boolean => exists(join(runtimeRoot, "whisper-cpp", CUDA_DLL));

export const createWhisperCppEngine = (
  options: WhisperCppEngineOptions
): TranscriptionEngine => {
  let cudaCache: "cuda" | "cpu" | null = null;

  const exec = options.deps?.execFile ?? execFileAsync;
  const writeAudio = options.deps?.writeFile ?? writeFile;
  const removeFile = options.deps?.unlink ?? unlink;
  const fileExists = options.deps?.exists ?? existsSync;
  const readOutput =
    options.deps?.readFile ?? ((path: string) => readFile(path, "utf8"));

  /**
   * The JSON side file, when the run produced one. A missing or malformed
   * file is not a failure: stdout still carries the transcript, so the caller
   * falls back to it rather than losing a decode that actually succeeded.
   */
  const readJsonOutput = async (
    path: string
  ): Promise<{ text: string; language: string | null } | null> => {
    try {
      const parsed = parseWhisperJson(await readOutput(path));
      return parsed !== null && parsed.text.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  };

  const binaryPath = join(options.runtimeRoot, "whisper-cpp", "whisper-cli.exe");

  // The model lives in the catalog download tree: modelsRoot/<modelId>/<file>.
  // Resolved per call, because the user can change the model in Settings, and
  // the file name comes from the catalog so every whisper size resolves.
  // Hardcoding one name only ever finds the model it was named after.
  const currentModelId = (): string =>
    options.getModelId?.() ?? options.modelId ?? DEFAULT_MODEL_ID;

  const modelPathFor = (id: string): string =>
    join(options.modelsRoot, id, findModel(id)?.files[0]?.path ?? DEFAULT_MODEL_FILE);

  const detectCuda = async (): Promise<"cuda" | "cpu"> => {
    if (cudaCache !== null) return cudaCache;
    const detect = options.deps?.detectCuda;
    cudaCache =
      detect !== undefined
        ? await detect()
        : hasCudaRuntime(options.runtimeRoot, fileExists)
          ? "cuda"
          : "cpu";
    return cudaCache;
  };

  const computeReadiness = (): EngineReadiness => {
    if (!fileExists(binaryPath)) {
      return { ready: false, reason: NOT_INSTALLED_MESSAGE, action: "install-runtime" };
    }
    if (!fileExists(modelPathFor(currentModelId()))) {
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
      const tempBase = join(
        tmpdir(),
        `struq-voice-whisper-${String(Date.now())}-${Math.random().toString(36).slice(2)}`
      );
      const tempWav = `${tempBase}.wav`;
      // whisper-cli appends .json to --output-file. Nothing used to delete it,
      // so every whisper capture left a file behind in the temp directory.
      const tempJson = `${tempBase}.json`;
      const startedAt = Date.now();
      const modelId = currentModelId();
      return (async () => {
        try {
          await writeAudio(tempWav, buildWav(request.pcm));

          const args: string[] = [
            "-m", modelPathFor(modelId),
            "-f", tempWav,
            "-t", "8",
            "--output-json",
            "--output-file", tempBase,
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
            // The sidecar must outlive the router's budget rather than kill
            // itself first: a fixed 60s here cut every long capture short
            // whatever the router allowed. Both now scale with the audio.
            timeout: transcribeTimeoutMs("local", request.durationMs) + 5_000,
            windowsHide: true,
            // Without this the sidecar runs on after the router gives up and
            // lingers as an orphaned GPU process.
            signal: request.signal
          });
          const inferenceMs = Date.now() - startedAt;
          const parsed = await readJsonOutput(tempJson);
          return ok({
            text: parsed?.text ?? parseTranscript(stdout),
            language: parsed?.language ?? request.language ?? null,
            engineId: WHISPER_CPP_ENGINE_ID,
            modelId,
            inferenceMs,
            realtimeFactor: inferenceMs / Math.max(request.durationMs, 1),
            costUsd: null
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return fail(whisperFailure(message));
        } finally {
          await Promise.all([
            removeFile(tempWav).catch(() => undefined),
            removeFile(tempJson).catch(() => undefined)
          ]);
        }
      })();
    },
    dispose: (): Promise<void> => Promise.resolve()
  };
};
