import { describe, expect, it } from "vitest";
import { createArchiveWriter } from "./archive-writer";
import type { ArchiveWriterDeps } from "./archive-writer";
import type { WriteStream } from "node:fs";

interface FakeStream {
  readonly chunks: Buffer[];
  readonly endCallbacks: Array<() => void>;
  readonly path: string;
  write: (data: Buffer, callback: (error: Error | null) => void) => void;
  end: (callback: () => void) => void;
}

const makeFakeStream = (path: string): FakeStream => {
  const stream = {
    chunks: [] as Buffer[],
    endCallbacks: [] as Array<() => void>,
    path,
    write: (data: Buffer, callback: (error: Error | null) => void): void => {
      stream.chunks.push(data);
      callback(null);
    },
    end: (callback: () => void): void => {
      stream.endCallbacks.push(callback);
      setTimeout(callback, 0);
    }
  };
  return stream;
};

const makeDeps = (): ArchiveWriterDeps & { streams: FakeStream[] } => {
  const streams: FakeStream[] = [];
  return {
    streams,
    createStream: (path: string): WriteStream => {
      const stream = makeFakeStream(path);
      streams.push(stream);
      return stream as unknown as WriteStream;
    },
    stat: () => Promise.resolve({ size: 42 })
  };
};

describe("archive writer", () => {
  it("queues appends without blocking and reports the byte count on close", async () => {
    const deps = makeDeps();
    const writer = createArchiveWriter(deps);
    const opened = await writer.open("/meetings/1/recording.webm");
    expect(opened.ok).toBe(true);
    writer.append(new ArrayBuffer(16));
    writer.append(new ArrayBuffer(16));
    expect(writer.isOpen()).toBe(true);
    const size = await writer.close();
    expect(size).toBe(42);
    expect(writer.isOpen()).toBe(false);
  });

  it("returns zero bytes when closed without opening", async () => {
    const writer = createArchiveWriter(makeDeps());
    expect(await writer.close()).toBe(0);
  });

  it("fails to open a second time", async () => {
    const writer = createArchiveWriter(makeDeps());
    await writer.open("/meetings/1/recording.webm");
    const second = await writer.open("/meetings/2/recording.webm");
    expect(second.ok).toBe(false);
  });
});
