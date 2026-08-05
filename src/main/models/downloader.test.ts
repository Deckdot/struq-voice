/**
 * Tests for the model downloader. Uses a fake fetch backed by node web
 * streams so range resumption, cancellation, the three-transfer concurrency
 * cap and the progress throttle can be exercised without a real network.
 * Each test gets its own temp models root and cleans it up afterwards.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { ModelFile, ModelInfo } from "../../shared/models";
import { MAX_CONCURRENT_FILES, createDownloader } from "./downloader";

interface FakeResponse {
  status: number;
  headers: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
}

interface FetchCall {
  url: string;
  range: string | null;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface Entry {
  path: string;
  content: string;
}

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const bodyFrom = (chunks: ReadonlyArray<string | Buffer>): ReadableStream<Uint8Array> =>
  Readable.toWeb(Readable.from(chunks.map((chunk) => Buffer.from(chunk)))) as ReadableStream<Uint8Array>;

const response = (
  status: number,
  chunks: ReadonlyArray<string | Buffer> = [],
  headers: Record<string, string> = {}
): FakeResponse => ({
  status,
  headers: { get: (name) => headers[name] ?? null },
  body: bodyFrom(chunks)
});

const makeFetch = (
  respond: (url: string, init?: RequestInit) => FakeResponse | Promise<FakeResponse>
): { fetch: typeof fetch; calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  const fetchImpl = (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<FakeResponse> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, range: headers.get("range") });
    return Promise.resolve(respond(url, init));
  };
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
};

const abortableBody = (firstChunk: Buffer, signal: AbortSignal): ReadableStream<Uint8Array> => {
  let sentFirst = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sentFirst) {
        sentFirst = true;
        controller.enqueue(firstChunk);
        return;
      }
      return new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (signal.aborted) {
            clearInterval(timer);
            controller.error(new Error("Aborted"));
            resolve();
          }
        }, 2);
      });
    }
  });
};

const hangingBody = (signal: AbortSignal): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    pull(controller) {
      return new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (signal.aborted) {
            clearInterval(timer);
            controller.error(new Error("Aborted"));
            resolve();
          }
        }, 2);
      });
    }
  });

const abortableResponse = (firstChunk: Buffer, init?: RequestInit): FakeResponse => ({
  status: 200,
  headers: { get: () => null },
  body: abortableBody(firstChunk, init?.signal ?? new AbortController().signal)
});

const hangingResponse = (init?: RequestInit): FakeResponse => ({
  status: 200,
  headers: { get: () => null },
  body: hangingBody(init?.signal ?? new AbortController().signal)
});

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeFile = (path: string, content: string): ModelFile => ({
  path,
  url: `https://example.test/${path}`,
  bytes: Buffer.byteLength(content),
  sha256: sha256(content)
});

let modelCounter = 0;

const makeModel = (files: readonly ModelFile[]): ModelInfo => {
  modelCounter += 1;
  return {
    id: `test-model-${String(modelCounter)}`,
    name: "Test Model",
    engine: "parakeet",
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    languages: "Test",
    whenToUse: "Test",
    license: "Apache 2.0",
    files
  };
};

const modelFromEntries = (
  entries: readonly Entry[]
): { model: ModelInfo; contentByPath: Map<string, string> } => {
  const contentByPath = new Map(entries.map((entry) => [entry.path, entry.content]));
  const files = entries.map((entry) => makeFile(entry.path, entry.content));
  return { model: makeModel(files), contentByPath };
};

const pathOf = (url: string): string => new URL(url).pathname.slice(1);

const respondWithContent = (contentByPath: Map<string, string>, url: string): FakeResponse =>
  response(200, [contentByPath.get(pathOf(url)) ?? ""]);

const resolveGate = (
  index: number,
  gates: Deferred<FakeResponse>[],
  calls: FetchCall[],
  contentByPath: Map<string, string>
): void => {
  const call = calls[index]!;
  gates[index]!.resolve(response(200, [contentByPath.get(pathOf(call.url)) ?? ""]));
};

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error(`waitFor timed out after ${String(timeoutMs)}ms`);
};

const withRoot = async (fn: (root: string) => void | Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "sv-dl-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("model downloader", () => {
  it("writes verified files into place on a fresh download", async () => {
    await withRoot(async (root) => {
      const { model, contentByPath } = modelFromEntries([
        { path: "encoder.bin", content: "hello-encoder" },
        { path: "decoder.bin", content: "hello-decoder" }
      ]);
      const { fetch } = makeFetch((url) => respondWithContent(contentByPath, url));
      const downloader = createDownloader(root, { fetch, emitProgress: () => {} });

      await downloader.start(model).done;

      expect(downloader.state(model.id)).toEqual({ state: "done" });
      for (const file of model.files) {
        const written = await readFile(join(root, model.id, file.path), "utf8");
        expect(written).toBe(contentByPath.get(file.path));
      }
    });
  });

  it("resumes a partial download with a range request", async () => {
    await withRoot(async (root) => {
      const firstChunk = Buffer.alloc(32768, "a");
      const remainder = Buffer.from("remainder-data");
      const full = Buffer.concat([firstChunk, remainder]);
      const { model } = modelFromEntries([{ path: "blob.bin", content: full.toString("utf8") }]);
      const file = model.files[0]!;
      const partPath = join(root, model.id, ".partial", `${file.path}.part`);

      let callIndex = 0;
      const { fetch, calls } = makeFetch((_url, init) => {
        const index = callIndex;
        callIndex += 1;
        if (index === 0) {
          return abortableResponse(firstChunk, init);
        }
        return response(206, [remainder]);
      });
      const downloader = createDownloader(root, { fetch, emitProgress: () => {} });

      const handle = downloader.start(model);
      await waitFor(async () => {
        try {
          const stats = await stat(partPath);
          return stats.size >= firstChunk.length;
        } catch {
          return false;
        }
      });
      handle.abort();
      await handle.done;

      expect(downloader.state(model.id)).toEqual({ state: "idle" });

      await downloader.start(model).done;

      expect(calls[0]?.range).toBeNull();
      expect(calls[1]?.range).toBe(`bytes=${String(firstChunk.length)}-`);
      expect(downloader.state(model.id)).toEqual({ state: "done" });
      const written = await readFile(join(root, model.id, file.path), "utf8");
      expect(written).toBe(full.toString("utf8"));
    });
  });

  it("restarts from zero when the server returns 200 despite a leftover part", async () => {
    await withRoot(async (root) => {
      const { model, contentByPath } = modelFromEntries([
        { path: "model.bin", content: "full-content-here" }
      ]);
      const file = model.files[0]!;
      const partPath = join(root, model.id, ".partial", `${file.path}.part`);
      const metaPath = `${partPath}.json`;
      await mkdir(dirname(partPath), { recursive: true });
      await writeFile(partPath, "STALE-PARTIAL-DATA", "utf8");
      await writeFile(
        metaPath,
        JSON.stringify({ url: file.url, expectedSha256: file.sha256, receivedBytes: 999 }),
        "utf8"
      );

      const { fetch, calls } = makeFetch((url) => respondWithContent(contentByPath, url));
      const downloader = createDownloader(root, { fetch, emitProgress: () => {} });

      await downloader.start(model).done;

      expect(calls[0]?.range).toBeNull();
      expect(downloader.state(model.id)).toEqual({ state: "done" });
      const written = await readFile(join(root, model.id, file.path), "utf8");
      expect(written).toBe("full-content-here");
    });
  });

  it("fails cleanly when the downloaded file hash does not match the catalog", async () => {
    await withRoot(async (root) => {
      const content = "actual-content";
      const file = makeFile("model.bin", content);
      const model = makeModel([{ ...file, sha256: sha256("expected-different") }]);
      const { fetch } = makeFetch(() => response(200, [content]));
      const downloader = createDownloader(root, { fetch, emitProgress: () => {} });

      await downloader.start(model).done;

      const state = downloader.state(model.id);
      expect(state.state).toBe("error");
      if (state.state === "error") {
        expect(state.message).toContain("Hash mismatch");
      }
      await expect(stat(join(root, model.id, file.path))).rejects.toThrow();
    });
  });

  it("keeps the partial file when a download is cancelled", async () => {
    await withRoot(async (root) => {
      const file = makeFile("model.bin", "never-arrives");
      const model = makeModel([file]);
      const partPath = join(root, model.id, ".partial", `${file.path}.part`);
      const metaPath = `${partPath}.json`;
      const { fetch } = makeFetch((_url, init) => hangingResponse(init));
      const downloader = createDownloader(root, { fetch, emitProgress: () => {} });

      const handle = downloader.start(model);
      await waitFor(async () => {
        try {
          await stat(partPath);
          return true;
        } catch {
          return false;
        }
      });
      handle.abort();
      await handle.done;

      expect(downloader.state(model.id)).toEqual({ state: "idle" });
      expect(existsSync(partPath)).toBe(true);
      expect(existsSync(metaPath)).toBe(true);
    });
  });

  it("caps concurrent file downloads at the slot limit", async () => {
    await withRoot(async (root) => {
      // One more model than the cap, so the last one has to wait for a slot.
      const count = MAX_CONCURRENT_FILES + 1;
      const entries = Array.from({ length: count }, (_unused, index) => ({
        path: `${String(index)}.bin`,
        content: `content-${String(index)}`
      }));
      const built = entries.map((entry) => modelFromEntries([entry]));
      const contentByPath = new Map(
        built.flatMap((b) => Array.from(b.contentByPath.entries()))
      );
      const gates = entries.map(() => deferred<FakeResponse>());
      let issued = 0;
      const { fetch, calls } = makeFetch((_url) => {
        const index = issued;
        issued += 1;
        return gates[index]!.promise;
      });
      const downloader = createDownloader(root, { fetch, emitProgress: () => {} });

      const handles = built.map((b) => downloader.start(b.model));
      await waitFor(() => issued >= MAX_CONCURRENT_FILES);
      expect(issued).toBe(MAX_CONCURRENT_FILES);

      // Freeing one slot lets exactly one more start.
      resolveGate(0, gates, calls, contentByPath);
      await waitFor(() => issued >= count);
      expect(issued).toBe(count);

      for (let index = 1; index < count; index += 1) {
        resolveGate(index, gates, calls, contentByPath);
      }
      await Promise.all(handles.map((handle) => handle.done));

      for (const b of built) {
        expect(downloader.state(b.model.id)).toEqual({ state: "done" });
      }
    });
  });

  // Files within one model must overlap: downloading them one at a time is
  // several times slower, because a single CDN connection is throttled.
  it("downloads the files of a model concurrently", async () => {
    await withRoot(async (root) => {
      const built = modelFromEntries([
        { path: "one.bin", content: "content-one" },
        { path: "two.bin", content: "content-two" },
        { path: "three.bin", content: "content-three" }
      ]);
      const gates = [0, 1, 2].map(() => deferred<FakeResponse>());
      let issued = 0;
      const { fetch, calls } = makeFetch((_url) => {
        const index = issued;
        issued += 1;
        return gates[index]!.promise;
      });
      const downloader = createDownloader(root, { fetch, emitProgress: () => {} });
      const handle = downloader.start(built.model);

      // All three requests are in flight before any of them resolves.
      await waitFor(() => issued >= 3);
      expect(issued).toBe(3);

      for (let index = 0; index < 3; index += 1) {
        resolveGate(index, gates, calls, built.contentByPath);
      }
      await handle.done;
      expect(downloader.state(built.model.id)).toEqual({ state: "done" });
    });
  });

  it("throttles progress emits and emits a single final tick", async () => {
    await withRoot(async (root) => {
      const chunks = Array.from({ length: 100 }, (_, index) => Buffer.from(`chunk-${String(index)}`));
      const content = Buffer.concat(chunks).toString("utf8");
      const { model } = modelFromEntries([{ path: "big.bin", content }]);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        }
      });
      const emits: Array<{ now: number; receivedBytes: number; totalBytes: number }> = [];
      const { fetch } = makeFetch(
        () => ({ status: 200, headers: { get: () => null }, body })
      );
      const downloader = createDownloader(root, {
        fetch,
        emitProgress: (event) => {
          emits.push({
            now: Date.now(),
            receivedBytes: event.receivedBytes,
            totalBytes: event.totalBytes
          });
        }
      });

      await downloader.start(model).done;

      expect(emits.length).toBeLessThan(chunks.length);
      const last = emits[emits.length - 1];
      expect(last?.receivedBytes).toBe(model.bytes);
      expect(last?.totalBytes).toBe(model.bytes);

      const perMs = new Map<number, number>();
      for (const emit of emits) {
        perMs.set(emit.now, (perMs.get(emit.now) ?? 0) + 1);
      }
      for (const count of perMs.values()) {
        expect(count).toBeLessThanOrEqual(2);
      }
    });
  });

  it("reports idle for an unknown model id", async () => {
    await withRoot((root) => {
      const { fetch } = makeFetch(() => response(200));
      const downloader = createDownloader(root, { fetch, emitProgress: () => {} });

      expect(downloader.state("missing-model")).toEqual({ state: "idle" });
    });
  });
});
