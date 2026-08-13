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
  /** Mirrors the real stream: the writer attaches an error listener. */
  on: (event: string, listener: (error: unknown) => void) => FakeStream;
  /** Test hook: fire the stream error the writer is listening for. */
  emitError: (error: Error) => void;
  failWrites?: Error;
}

const makeFakeStream = (path: string): FakeStream => {
  const errorListeners: Array<(error: unknown) => void> = [];
  const stream: FakeStream = {
    chunks: [] as Buffer[],
    endCallbacks: [] as Array<() => void>,
    path,
    on: (event: string, listener: (error: unknown) => void): FakeStream => {
      if (event === "error") errorListeners.push(listener);
      return stream;
    },
    emitError: (error: Error): void => {
      for (const listener of errorListeners) listener(error);
    },
    write: (data: Buffer, callback: (error: Error | null) => void): void => {
      if (stream.failWrites !== undefined) {
        callback(stream.failWrites);
        return;
      }
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

/**
 * A write stream with no error listener turns a failed write into an
 * uncaught exception. Main has no uncaughtException handler, so a full disk
 * or a deleted directory used to kill the whole tray app in the middle of a
 * meeting. When it did not crash, the error was swallowed to a console
 * warning and close returned the truncated size, which the session then
 * filed as a complete recording.
 */
describe("archive writer failures", () => {
  it("attaches an error listener so a stream error cannot go unhandled", async () => {
    const deps = makeDeps();
    const writer = createArchiveWriter(deps);
    await writer.open("/meetings/1/recording.webm");
    const stream = deps.streams[0];
    if (stream === undefined) throw new Error("no stream was created");

    expect(() => {
      stream.emitError(new Error("ENOSPC: no space left on device"));
    }).not.toThrow();
    expect(writer.lastError()).toContain("ENOSPC");
  });

  it("reports a failed recording as null rather than a truncated size", async () => {
    const deps = makeDeps();
    const writer = createArchiveWriter(deps);
    await writer.open("/meetings/1/recording.webm");
    const stream = deps.streams[0];
    if (stream === undefined) throw new Error("no stream was created");
    stream.emitError(new Error("ENOSPC: no space left on device"));

    // stat would happily report the bytes that made it to disk.
    expect(await writer.close()).toBeNull();
  });

  it("records a failing write", async () => {
    const deps = makeDeps();
    const writer = createArchiveWriter(deps);
    await writer.open("/meetings/1/recording.webm");
    const stream = deps.streams[0];
    if (stream === undefined) throw new Error("no stream was created");
    stream.failWrites = new Error("EACCES: permission denied");

    writer.append(new ArrayBuffer(16));

    expect(writer.lastError()).toContain("EACCES");
    expect(await writer.close()).toBeNull();
  });

  it("reports the byte count when the recording is healthy", async () => {
    const deps = makeDeps();
    const writer = createArchiveWriter(deps);
    await writer.open("/meetings/1/recording.webm");

    writer.append(new ArrayBuffer(16));

    expect(await writer.close()).toBe(42);
    expect(writer.lastError()).toBeNull();
  });
});
