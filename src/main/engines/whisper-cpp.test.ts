import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WHISPER_CPP_ENGINE_ID,
  createWhisperCppEngine,
  type WhisperCppDeps
} from "./whisper-cpp";

/**
 * Unit tests for the whisper.cpp engine. Everything process- or fs-touching
 * is injected, so no binary or model is required. The parse/decision logic
 * is what matters here; the spawn contract is verified by e2e later.
 */

const request = (): { pcm: Int16Array; durationMs: number; signal: AbortSignal } => ({
  pcm: new Int16Array([0, 100, -100, 0]),
  durationMs: 100,
  signal: new AbortController().signal
});

/** The shape whisper-cli writes to `<output-file>.json`. */
const whisperJson = (
  segments: ReadonlyArray<{ text: string }>,
  language = "en"
): string => JSON.stringify({ result: { language }, transcription: segments });

const makeDeps = (
  overrides: Partial<WhisperCppDeps> = {}
): {
  deps: WhisperCppDeps;
  calls: { writes: string[]; deletes: string[]; execs: Array<{ args: string[] }> };
} => {
  const calls = { writes: [] as string[], deletes: [] as string[], execs: [] as Array<{ args: string[] }> };
  const deps: WhisperCppDeps = {
    exists: () => true,
    writeFile: async (path: string) => {
      calls.writes.push(path);
      await Promise.resolve();
    },
    readFile: async () => {
      await Promise.resolve();
      return whisperJson([{ text: " hello world" }]);
    },
    unlink: async (path: string) => {
      calls.deletes.push(path);
      await Promise.resolve();
    },
    execFile: async (_command: string, args: readonly string[]) => {
      calls.execs.push({ args: [...args] });
      await Promise.resolve();
      return { stdout: "hello world", stderr: "" };
    },
    detectCuda: async () => {
      await Promise.resolve();
      return "cpu";
    },
    ...overrides
  };
  return { deps, calls };
};

const runtimeRoot = "C:\\fake\\runtimes";
const modelsRoot = "C:\\fake\\models";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("whisper-cpp engine", () => {
  it("is ready when both binary and model exist", async () => {
    const { deps } = makeDeps();
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await expect(engine.readiness()).resolves.toEqual({ ready: true });
  });

  it("reports install-runtime when the binary is missing", async () => {
    const { deps } = makeDeps({ exists: () => false });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await expect(engine.readiness()).resolves.toMatchObject({
      ready: false,
      action: "install-runtime"
    });
  });

  it("reports download-model when the runtime is complete but the model is not", async () => {
    const { deps } = makeDeps({
      exists: (path: string) => path.includes("whisper-cpp")
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await expect(engine.readiness()).resolves.toMatchObject({
      ready: false,
      action: "download-model"
    });
  });

  /**
   * whisper-cli.exe is dynamically linked. An install that dropped only the
   * exe on disk passed the old readiness check, so the app said whisper was
   * ready and then every capture died at spawn with a bare
   * "Command failed: <path>".
   */
  it("is not ready when the exe is present but its DLLs are missing", async () => {
    const { deps } = makeDeps({
      exists: (path: string) => path.includes("whisper-cli.exe")
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    const readiness = await engine.readiness();
    expect(readiness).toMatchObject({ ready: false, action: "install-runtime" });
    expect(readiness.reason).toContain("incomplete");
  });

  it("is not ready when no ggml CPU backend sits beside the exe", async () => {
    const { deps } = makeDeps({
      exists: (path: string) => path.includes("whisper-cpp") && !path.includes("ggml-cpu")
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await expect(engine.readiness()).resolves.toMatchObject({
      ready: false,
      action: "install-runtime"
    });
  });

  it("blames the runtime, not the user, when Windows refuses to start the exe", async () => {
    const { deps } = makeDeps({
      exists: (path: string) => path.includes("whisper-cli.exe"),
      execFile: () => {
        // What promisify(execFile) rejects with for STATUS_DLL_NOT_FOUND: the
        // command line as the message, an empty stderr, and the exit code.
        const error = Object.assign(
          new Error(`Command failed: ${runtimeRoot}\\whisper-cpp\\whisper-cli.exe -m ...`),
          { code: 0xc0000135 | 0, stderr: "" }
        );
        return Promise.reject(error);
      }
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    const outcome = await engine.transcribe(request());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toContain("Reinstall it in Settings");
      expect(outcome.error.message).not.toContain("Command failed");
    }
  });

  it("surfaces the last stderr line rather than the command line", async () => {
    const { deps } = makeDeps({
      execFile: () =>
        Promise.reject(
          Object.assign(new Error("Command failed: whisper-cli.exe -m C:\\a\\b.bin"), {
            code: 1,
            stderr: "whisper_init_from_file_with_params_no_state: failed to load model\n"
          })
        )
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    const outcome = await engine.transcribe(request());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toBe(
        "whisper_init_from_file_with_params_no_state: failed to load model"
      );
    }
  });

  it("transcribes a capture and deletes the temp wav", async () => {
    const { deps, calls } = makeDeps();
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    const outcome = await engine.transcribe(request());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.text).toBe("hello world");
    expect(outcome.value.engineId).toBe(WHISPER_CPP_ENGINE_ID);
    expect(calls.writes).toHaveLength(1);
    // The wav and the JSON side file whisper-cli writes next to it. Only the
    // wav used to be deleted, so every capture left a file in the temp dir.
    expect(calls.deletes).toContain(calls.writes[0]);
    expect(calls.deletes).toContain(`${calls.writes[0] ?? ""}.json`);
    expect(calls.execs[0]?.args).toContain("--output-json");
    expect(calls.execs[0]?.args).toContain("auto");
  });

  it("reports the language whisper actually decoded, not the requested one", async () => {
    const { deps } = makeDeps({
      readFile: async () => {
        await Promise.resolve();
        return whisperJson([{ text: " goedemorgen" }], "nl");
      }
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    const outcome = await engine.transcribe(request());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.language).toBe("nl");
      expect(outcome.value.text).toBe("goedemorgen");
    }
  });

  it("drops the non-speech markers whisper writes for silence and noise", async () => {
    const { deps } = makeDeps({
      readFile: async () => {
        await Promise.resolve();
        return whisperJson([
          { text: " [BLANK_AUDIO]" },
          { text: " Send the invoice today." },
          { text: " *keyboard clicking*" }
        ]);
      }
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    const outcome = await engine.transcribe(request());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.text).toBe("Send the invoice today.");
    }
  });

  it("passes the request language instead of auto", async () => {
    const { deps, calls } = makeDeps();
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await engine.transcribe({ ...request(), language: "nl" });
    const args = calls.execs[0]?.args ?? [];
    const langIndex = args.indexOf("-l");
    expect(langIndex).toBeGreaterThan(-1);
    expect(args[langIndex + 1]).toBe("nl");
  });

  it("returns a fail result instead of throwing on spawn error", async () => {
    const { deps } = makeDeps({
      execFile: async () => {
        await Promise.resolve();
        throw new Error("whisper-cli crashed");
      }
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    const outcome = await engine.transcribe(request());
    expect(outcome.ok).toBe(false);
  });

  it("falls back to stdout when the json side file is unreadable", async () => {
    const { deps } = makeDeps({
      readFile: async () => {
        await Promise.resolve();
        throw new Error("ENOENT");
      },
      execFile: async () => {
        await Promise.resolve();
        return { stdout: "first second\n", stderr: "" };
      }
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    const outcome = await engine.transcribe(request());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.text).toBe("first second");
    }
  });

  it("still cleans up the temp files when transcription fails", async () => {
    const { deps, calls } = makeDeps({
      execFile: async () => {
        await Promise.resolve();
        throw new Error("timeout");
      }
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await engine.transcribe(request());
    expect(calls.deletes).toHaveLength(2);
  });

  /**
   * The sidecar used to kill itself at a fixed sixty seconds whatever the
   * router allowed, so a long capture died inside whisper before the router's
   * budget was anywhere near spent.
   */
  it("gives the sidecar a budget that grows with the recording", async () => {
    let shortTimeout = 0;
    let longTimeout = 0;
    const capture = (into: (ms: number) => void): Partial<WhisperCppDeps> => ({
      execFile: async (_command: string, _args: readonly string[], opts: object) => {
        into((opts as { timeout?: number }).timeout ?? 0);
        await Promise.resolve();
        return { stdout: "ok", stderr: "" };
      }
    });

    const shortEngine = createWhisperCppEngine({
      runtimeRoot,
      modelsRoot,
      deps: makeDeps(capture((ms) => (shortTimeout = ms))).deps
    });
    await shortEngine.transcribe({ ...request(), durationMs: 2_000 });

    const longEngine = createWhisperCppEngine({
      runtimeRoot,
      modelsRoot,
      deps: makeDeps(capture((ms) => (longTimeout = ms))).deps
    });
    await longEngine.transcribe({ ...request(), durationMs: 300_000 });

    expect(longTimeout).toBeGreaterThan(shortTimeout);
    expect(longTimeout).toBeGreaterThan(300_000);
  });
});

/**
 * GPU selection. whisper-cli decodes on the CPU unless the CUDA backend and
 * its libraries are beside it, and `--no-gpu` is what forces that. The engine
 * decides per capture from what is on disk.
 */
describe("gpu selection", () => {
  const CUDA_FILES = [
    "ggml-cuda.dll",
    "cudart64_12.dll",
    "cublas64_12.dll",
    "cublasLt64_12.dll"
  ];
  const withCuda = (path: string): boolean => path.includes("whisper-cpp");
  const withoutCuda = (path: string): boolean =>
    path.includes("whisper-cpp") && !CUDA_FILES.some((name) => path.endsWith(name));

  /**
   * The shared makeDeps pins detectCuda to "cpu" so the other suites get a
   * stable command line. These tests are about that decision, so they leave
   * it out and let the engine read the runtime directory itself.
   */
  const gpuDeps = (
    exists: (path: string) => boolean
  ): { deps: WhisperCppDeps; calls: { execs: Array<{ args: string[] }> } } => {
    const calls = { execs: [] as Array<{ args: string[] }> };
    const deps: WhisperCppDeps = {
      exists,
      writeFile: () => Promise.resolve(),
      readFile: () => Promise.resolve(whisperJson([{ text: " hello" }])),
      unlink: () => Promise.resolve(),
      execFile: (_command: string, args: readonly string[]) => {
        calls.execs.push({ args: [...args] });
        return Promise.resolve({ stdout: "hello", stderr: "" });
      }
    };
    return { deps, calls };
  };

  it("passes --no-gpu when only the CPU runtime is installed", async () => {
    const { deps, calls } = gpuDeps(withoutCuda);
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await engine.transcribe(request());
    expect(calls.execs[0]?.args).toContain("--no-gpu");
  });

  it("lets whisper use the GPU once the CUDA runtime is installed", async () => {
    const { deps, calls } = gpuDeps(withCuda);
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await engine.transcribe(request());
    expect(calls.execs[0]?.args).not.toContain("--no-gpu");
  });

  /**
   * Installing the GPU runtime is something the user does with the app open.
   * The probe used to be cached for the process lifetime, so every capture
   * after the install would still have decoded on the CPU until a restart.
   */
  it("notices a GPU runtime installed after the first capture", async () => {
    let cudaPresent = false;
    const { deps, calls } = gpuDeps((path: string) =>
      cudaPresent ? withCuda(path) : withoutCuda(path)
    );
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await engine.transcribe(request());
    expect(calls.execs[0]?.args).toContain("--no-gpu");

    cudaPresent = true;
    calls.execs.length = 0;
    await engine.transcribe(request());
    expect(calls.execs[0]?.args).not.toContain("--no-gpu");
  });
});

/**
 * Model selection. The engine builds modelsRoot/<modelId>/<catalog file name>,
 * so every catalog size resolves; a hardcoded file name only ever finds the
 * one model it was named after.
 */
describe("model selection", () => {
  const modelArg = (calls: { execs: Array<{ args: string[] }> }): string => {
    const args = calls.execs[0]?.args ?? [];
    return args[args.indexOf("-m") + 1] ?? "";
  };

  it("resolves the ggml file name for a small model", async () => {
    const { deps, calls } = makeDeps();
    const engine = createWhisperCppEngine({
      runtimeRoot,
      modelsRoot,
      modelId: "whisper-small-q5_1",
      deps
    });
    await engine.transcribe(request());
    expect(modelArg(calls)).toContain("whisper-small-q5_1");
    expect(modelArg(calls)).toContain("ggml-small-q5_1.bin");
  });

  it("resolves a large model to its own file, not the default", async () => {
    const { deps, calls } = makeDeps();
    const engine = createWhisperCppEngine({
      runtimeRoot,
      modelsRoot,
      modelId: "whisper-large-v3",
      deps
    });
    await engine.transcribe(request());
    expect(modelArg(calls)).toContain("ggml-large-v3.bin");
    expect(modelArg(calls)).not.toContain("turbo");
  });

  it("reads getModelId at call time so a Settings change applies", async () => {
    const { deps, calls } = makeDeps();
    let selected = "whisper-tiny-q5_1";
    const engine = createWhisperCppEngine({
      runtimeRoot,
      modelsRoot,
      getModelId: () => selected,
      deps
    });
    await engine.transcribe(request());
    expect(modelArg(calls)).toContain("ggml-tiny-q5_1.bin");

    selected = "whisper-medium-q8_0";
    calls.execs.length = 0;
    await engine.transcribe(request());
    expect(modelArg(calls)).toContain("ggml-medium-q8_0.bin");
  });

  it("reports the selected model id on the result", async () => {
    const { deps } = makeDeps();
    const engine = createWhisperCppEngine({
      runtimeRoot,
      modelsRoot,
      modelId: "whisper-base-q5_1",
      deps
    });
    const outcome = await engine.transcribe(request());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.modelId).toBe("whisper-base-q5_1");
    }
  });
});
