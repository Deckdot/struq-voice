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

/**
 * The constructor throws on its first construction and succeeds afterwards,
 * simulating a transient ONNX init failure that a retry can clear.
 */
const makeRecoveringSherpa = (): { module: SherpaOnnxModule; constructions: () => number } => {
  let constructed = 0;
  const Recognizer = class implements SherpaOfflineRecognizer {
    constructor() {
      constructed += 1;
      if (constructed === 1) {
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
      return { text: "hello world" };
    }
  };
  return { module: { OfflineRecognizer: Recognizer }, constructions: () => constructed };
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

  it("reports not ready after a recognizer construction failure, then heals", async () => {
    const model = findModel(PARAKEET_DEFAULT_MODEL_ID);
    if (model === null) {
      throw new Error("catalog is missing the default Parakeet model");
    }
    const root = makeModelsRoot(
      PARAKEET_DEFAULT_MODEL_ID,
      model.files.map((file) => file.path)
    );
    const { module, constructions } = makeRecoveringSherpa();
    const engine = createParakeetEngine({
      modelsRoot: root,
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      loadRetryMs: 10,
      deps: { loadModule: () => module }
    });

    await engine.warmup();
    expect(constructions()).toBe(1);
    const first = await engine.readiness();
    expect(first.ready).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const healed = await engine.readiness();
    expect(healed.ready).toBe(true);

    // And a fresh construction attempt now succeeds without a restart.
    await engine.warmup();
    expect(constructions()).toBe(2);
  });

  it("retries a failed native module load after the retry window", async () => {
    const model = findModel(PARAKEET_DEFAULT_MODEL_ID);
    if (model === null) {
      throw new Error("catalog is missing the default Parakeet model");
    }
    const root = makeModelsRoot(
      PARAKEET_DEFAULT_MODEL_ID,
      model.files.map((file) => file.path)
    );
    let loads = 0;
    const engine = createParakeetEngine({
      modelsRoot: root,
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      loadRetryMs: 10,
      deps: {
        loadModule: (): SherpaOnnxModule => {
          loads += 1;
          if (loads === 1) {
            throw new Error("addon blocked by policy");
          }
          return makeFakeSherpa();
        }
      }
    });

    const first = await engine.readiness();
    expect(first.ready).toBe(false);
    expect(loads).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await engine.readiness();
    expect(second.ready).toBe(true);
    expect(loads).toBe(2);
  });

  it("resolves the model id from getModelId at transcribe time", async () => {
    const modelV3 = findModel(PARAKEET_DEFAULT_MODEL_ID);
    const modelV2 = findModel("parakeet-tdt-0.6b-v2-int8");
    if (modelV3 === null || modelV2 === null) {
      throw new Error("catalog is missing a Parakeet model");
    }
    const root = mkdtempSync(join(tmpdir(), "sv-par-"));
    tempDirs.push(root);
    for (const model of [modelV3, modelV2]) {
      const modelDir = join(root, model.id);
      mkdirSync(modelDir, { recursive: true });
      for (const file of model.files) {
        writeFileSync(join(modelDir, file.path), Buffer.alloc(0));
      }
    }
    let resolved = PARAKEET_DEFAULT_MODEL_ID;
    const engine = createParakeetEngine({
      modelsRoot: root,
      getModelId: () => resolved,
      deps: { loadModule: () => makeFakeSherpa() }
    });

    const first = await engine.transcribe(request());
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.modelId).toBe(PARAKEET_DEFAULT_MODEL_ID);
    }

    resolved = "parakeet-tdt-0.6b-v2-int8";
    const second = await engine.transcribe(request());
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.modelId).toBe("parakeet-tdt-0.6b-v2-int8");
    }
  });
});
