/**
 * Unit tests for the Parakeet engine's gateable paths. The native
 * sherpa-onnx-node addon is never loaded here; every test injects a fake
 * module through deps.loadModule and asserts only the pure, gateable parts.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findModel } from "../../shared/models";
import type { TranscribeRequest } from "./types";
import {
  createParakeetEngine,
  PARAKEET_DEFAULT_MODEL_ID,
  type SherpaOfflineRecognizer,
  type SherpaOfflineStream,
  type SherpaOnnxModule
} from "./parakeet";

const tempDirs: string[] = [];

const makeEmptyModelsRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "sv-par-"));
  tempDirs.push(root);
  return root;
};

const makeModelsRoot = (
  modelId: string,
  fileNames: readonly string[]
): string => {
  const root = mkdtempSync(join(tmpdir(), "sv-par-"));
  tempDirs.push(root);
  const modelDir = join(root, modelId);
  mkdirSync(modelDir, { recursive: true });
  for (const fileName of fileNames) {
    writeFileSync(join(modelDir, fileName), Buffer.alloc(0));
  }
  return root;
};

const makeFakeSherpa = (options?: {
  readonly constructorThrows?: boolean;
  readonly text?: string;
}): SherpaOnnxModule => {
  const Recognizer = class implements SherpaOfflineRecognizer {
    constructor() {
      if (options?.constructorThrows === true) {
        throw new Error("constructor exploded");
      }
    }
    createStream(): SherpaOfflineStream {
      return {
        acceptWaveform: (_waveform): void => {}
      };
    }
    decode(_stream: SherpaOfflineStream): void {}
    getResult(_stream: SherpaOfflineStream): { readonly text?: string } {
      return { text: options?.text ?? "hello world" };
    }
  };
  return { OfflineRecognizer: Recognizer };
};

const request = (): TranscribeRequest => ({
  pcm: new Int16Array([1, 2, 3]),
  durationMs: 100,
  signal: new AbortController().signal
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parakeet engine", () => {
  it("reports install-runtime when the native module cannot be required", async () => {
    const engine = createParakeetEngine({
      modelsRoot: makeEmptyModelsRoot(),
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      deps: {
        loadModule: (): SherpaOnnxModule => {
          throw new Error("Cannot find module 'sherpa-onnx-node'");
        }
      }
    });

    const readiness = await engine.readiness();
    expect(readiness.ready).toBe(false);
    if (!readiness.ready) {
      expect(readiness.action).toBe("install-runtime");
      expect(readiness.reason).toContain("not installed");
    }

    const result = await engine.transcribe(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARAKEET");
      expect(result.error.message).toContain("not installed");
    }
  });

  it("reports download-model when the model files are missing", async () => {
    const engine = createParakeetEngine({
      modelsRoot: makeEmptyModelsRoot(),
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      deps: { loadModule: () => makeFakeSherpa() }
    });

    const readiness = await engine.readiness();
    expect(readiness.ready).toBe(false);
    if (!readiness.ready) {
      expect(readiness.action).toBe("download-model");
      expect(readiness.reason).toContain("not downloaded");
    }
  });

  it("reports ready when all catalog files exist, without instantiating", async () => {
    const model = findModel(PARAKEET_DEFAULT_MODEL_ID);
    if (model === null) {
      throw new Error("catalog is missing the default Parakeet model");
    }
    const root = makeModelsRoot(
      PARAKEET_DEFAULT_MODEL_ID,
      model.files.map((file) => file.path)
    );
    const engine = createParakeetEngine({
      modelsRoot: root,
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      deps: { loadModule: () => makeFakeSherpa({ constructorThrows: true }) }
    });

    const readiness = await engine.readiness();
    expect(readiness.ready).toBe(true);
  });

  it("emits failed when the recognizer constructor throws", async () => {
    const model = findModel(PARAKEET_DEFAULT_MODEL_ID);
    if (model === null) {
      throw new Error("catalog is missing the default Parakeet model");
    }
    const root = makeModelsRoot(
      PARAKEET_DEFAULT_MODEL_ID,
      model.files.map((file) => file.path)
    );
    const states: ("cold" | "warming" | "warm" | "failed")[] = [];
    const engine = createParakeetEngine({
      modelsRoot: root,
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      onWarmup: (state): void => {
        states.push(state);
      },
      deps: { loadModule: () => makeFakeSherpa({ constructorThrows: true }) }
    });

    await engine.warmup();
    expect(states).toEqual(["warming", "failed"]);
  });

  it("returns a fail result when the recognizer is not available", async () => {
    const engine = createParakeetEngine({
      modelsRoot: makeEmptyModelsRoot(),
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      deps: { loadModule: () => makeFakeSherpa() }
    });

    const result = await engine.transcribe(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARAKEET");
      expect(result.error.message).toContain("not downloaded");
    }
  });
});
