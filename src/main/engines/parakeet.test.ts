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

interface AsyncHarness {
  readonly module: SherpaOnnxModule;
  readonly maxConcurrentDecodes: () => number;
  readonly decodeCalls: () => number;
}

const makeAsyncSherpa = (decodeDelayMs = 10): AsyncHarness => {
  let activeDecodes = 0;
  let maxActiveDecodes = 0;
  let decodeCalls = 0;
  const Recognizer = class implements SherpaOfflineRecognizer {
    static createAsync = (): Promise<SherpaOfflineRecognizer> =>
      Promise.resolve(new Recognizer());
    createStream(): SherpaOfflineStream {
      return {
        acceptWaveform: (_waveform): void => {}
      };
    }
    decode(_stream: SherpaOfflineStream): void {
      decodeCalls += 1;
    }
    async decodeAsync(
      _stream: SherpaOfflineStream
    ): Promise<{ readonly text?: string }> {
      decodeCalls += 1;
      activeDecodes += 1;
      maxActiveDecodes = Math.max(maxActiveDecodes, activeDecodes);
      await new Promise((resolve) => setTimeout(resolve, decodeDelayMs));
      activeDecodes -= 1;
      return { text: "async hello" };
    }
    getResult(_stream: SherpaOfflineStream): { readonly text?: string } {
      return { text: "sync hello" };
    }
  };
  return {
    module: { OfflineRecognizer: Recognizer },
    maxConcurrentDecodes: () => maxActiveDecodes,
    decodeCalls: () => decodeCalls
  };
};

const makeModelsRootForDefault = (): string => {
  const model = findModel(PARAKEET_DEFAULT_MODEL_ID);
  if (model === null) {
    throw new Error("catalog is missing the default Parakeet model");
  }
  return makeModelsRoot(
    PARAKEET_DEFAULT_MODEL_ID,
    model.files.map((file) => file.path)
  );
};

describe("parakeet async runtime", () => {
  it("constructs the recognizer through the async factory during warmup", async () => {
    let asyncConstruction = 0;
    let syncConstruction = 0;
    const makeInstance = (): SherpaOfflineRecognizer => ({
      createStream: (): SherpaOfflineStream => ({
        acceptWaveform: (_waveform): void => {}
      }),
      decode: (_stream): void => {},
      getResult: (_stream): { readonly text?: string } => ({ text: "hello" })
    });
    const Recognizer = class implements SherpaOfflineRecognizer {
      static createAsync = (): Promise<SherpaOfflineRecognizer> => {
        asyncConstruction += 1;
        return Promise.resolve(makeInstance());
      };
      constructor() {
        syncConstruction += 1;
      }
      createStream(): SherpaOfflineStream {
        return {
          acceptWaveform: (_waveform): void => {}
        };
      }
      decode(_stream: SherpaOfflineStream): void {}
      getResult(_stream: SherpaOfflineStream): { readonly text?: string } {
        return { text: "hello" };
      }
    };
    const states: ("cold" | "warming" | "warm" | "failed")[] = [];
    const engine = createParakeetEngine({
      modelsRoot: makeModelsRootForDefault(),
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      onWarmup: (state): void => {
        states.push(state);
      },
      deps: { loadModule: () => ({ OfflineRecognizer: Recognizer }) }
    });

    await engine.warmup();
    expect(states).toEqual(["warming", "warm"]);
    expect(asyncConstruction).toBe(1);
    expect(syncConstruction).toBe(0);
  });

  it("decodes through the async path when the runtime provides it", async () => {
    const harness = makeAsyncSherpa();
    const engine = createParakeetEngine({
      modelsRoot: makeModelsRootForDefault(),
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      deps: { loadModule: () => harness.module }
    });

    const result = await engine.transcribe(request());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("async hello");
    }
    expect(harness.decodeCalls()).toBe(1);
  });

  it("never runs two decodes on the recognizer at once", async () => {
    const harness = makeAsyncSherpa(10);
    const engine = createParakeetEngine({
      modelsRoot: makeModelsRootForDefault(),
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      deps: { loadModule: () => harness.module }
    });

    const [first, second] = await Promise.all([
      engine.transcribe(request()),
      engine.transcribe(request())
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(harness.maxConcurrentDecodes()).toBe(1);
    expect(harness.decodeCalls()).toBe(2);
  });

  it("skips a request aborted while waiting behind another decode", async () => {
    const harness = makeAsyncSherpa(20);
    const engine = createParakeetEngine({
      modelsRoot: makeModelsRootForDefault(),
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      deps: { loadModule: () => harness.module }
    });

    const first = engine.transcribe(request());
    await new Promise((resolve) => setTimeout(resolve, 5));

    const controller = new AbortController();
    const second = engine.transcribe({
      pcm: new Int16Array([4, 5, 6]),
      durationMs: 100,
      signal: controller.signal
    });
    controller.abort();

    const firstResult = await first;
    expect(firstResult.ok).toBe(true);

    const secondResult = await second;
    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) {
      expect(secondResult.error.message).toContain("cancelled");
    }
    // Only the first request reached the native decode.
    expect(harness.decodeCalls()).toBe(1);
  });

  it("falls back to the synchronous decode when the async one rejects", async () => {
    const Recognizer = class implements SherpaOfflineRecognizer {
      static createAsync = (): Promise<SherpaOfflineRecognizer> =>
        Promise.resolve(new Recognizer());
      createStream(): SherpaOfflineStream {
        return {
          acceptWaveform: (_waveform): void => {}
        };
      }
      decode(_stream: SherpaOfflineStream): void {}
      decodeAsync(): Promise<{ readonly text?: string }> {
        return Promise.reject(new Error("async decode not supported for this model"));
      }
      getResult(_stream: SherpaOfflineStream): { readonly text?: string } {
        return { text: "sync hello" };
      }
    };
    const engine = createParakeetEngine({
      modelsRoot: makeModelsRootForDefault(),
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      deps: { loadModule: () => ({ OfflineRecognizer: Recognizer }) }
    });

    const result = await engine.transcribe(request());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("sync hello");
    }
  });
});

/**
 * The native decode cannot be cancelled, but the request can stop waiting.
 * Without that the router's 20s local timeout never fired for Parakeet: a
 * stalled decode held the request open forever and no fallback engaged.
 */
describe("parakeet abort and labelling", () => {
  it("gives up waiting when the signal aborts mid-decode", async () => {
    const harness = makeAsyncSherpa(10_000);
    const engine = createParakeetEngine({
      modelsRoot: makeModelsRootForDefault(),
      modelId: PARAKEET_DEFAULT_MODEL_ID,
      deps: { loadModule: () => harness.module }
    });
    const controller = new AbortController();

    const pending = engine.transcribe({
      pcm: new Int16Array([1, 2, 3]),
      durationMs: 100,
      signal: controller.signal
    });
    controller.abort();
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("cancelled");
    }
  });

  it("labels the result with the model that decoded it", async () => {
    const harness = makeAsyncSherpa(20);
    let selected = PARAKEET_DEFAULT_MODEL_ID;
    const engine = createParakeetEngine({
      modelsRoot: makeModelsRootForDefault(),
      getModelId: () => selected,
      deps: { loadModule: () => harness.module }
    });

    // Warm up first, so the recognizer for the default model already exists
    // and the switch below lands while that model is mid-decode rather than
    // before construction.
    await engine.warmup();
    const pending = engine.transcribe(request());
    // Land the switch once the decode is genuinely under way: the queued job
    // resolves the recognizer asynchronously, so switching in the same tick
    // would simply build v2 up front and prove nothing.
    await new Promise((resolve) => setTimeout(resolve, 5));
    selected = "parakeet-tdt-0.6b-v2-int8";
    const result = await pending;

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The text came from the default model's weights, so that is the id
      // that belongs in History.
      expect(result.value.modelId).toBe(PARAKEET_DEFAULT_MODEL_ID);
    }
  });
});
