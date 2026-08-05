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
    unlink: async (path: string) => {
      calls.deletes.push(path);
      await Promise.resolve();
    },
    execFile: async (_command: string, args: readonly string[]) => {
      calls.execs.push({ args: [...args] });
      await Promise.resolve();
      return { stdout: JSON.stringify({ text: "hello world" }), stderr: "" };
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

  it("reports download-model when only the binary exists", async () => {
    const { deps } = makeDeps({
      exists: (path: string) => path.includes("whisper-cli.exe")
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await expect(engine.readiness()).resolves.toMatchObject({
      ready: false,
      action: "download-model"
    });
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
    expect(calls.deletes).toHaveLength(1);
    expect(calls.deletes[0]).toBe(calls.writes[0]);
    expect(calls.execs[0]?.args).toContain("--output-json");
    expect(calls.execs[0]?.args).toContain("auto");
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

  it("falls back to segment text when the top-level text key is absent", async () => {
    const { deps } = makeDeps({
      execFile: async () => {
        await Promise.resolve();
        return {
          stdout: JSON.stringify({
            segments: [{ text: "first" }, { text: "second" }]
          }),
          stderr: ""
        };
      }
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    const outcome = await engine.transcribe(request());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.text).toBe("first second");
    }
  });

  it("still cleans up the temp wav when transcription fails", async () => {
    const { deps, calls } = makeDeps({
      execFile: async () => {
        await Promise.resolve();
        throw new Error("timeout");
      }
    });
    const engine = createWhisperCppEngine({ runtimeRoot, modelsRoot, deps });
    await engine.transcribe(request());
    expect(calls.deletes).toHaveLength(1);
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
