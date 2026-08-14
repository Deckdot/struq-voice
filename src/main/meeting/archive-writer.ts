/**
 * Appends opus chunks to the meeting archive file. A write stream in append
 * mode with an internal queue, so append never blocks the IPC handler; close
 * ends the stream and resolves the byte count from stat. Every filesystem
 * operation is injected so the module is unit testable with an in-memory fake.
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Result } from "../../shared/result";
import { fail, ok } from "../../shared/result";

export interface ArchiveWriter {
  open: (filePath: string) => Promise<Result<void>>;
  append: (bytes: ArrayBuffer) => void;
  /**
   * Ends the stream and resolves the bytes on disk, or null when the
   * recording failed. Null means the file is missing or truncated, so the
   * caller must not record the meeting as a complete recording.
   */
  close: () => Promise<number | null>;
  isOpen: () => boolean;
  /** The first write or stream error, or null while the archive is healthy. */
  lastError: () => string | null;
}

export interface ArchiveWriterDeps {
  readonly createStream?: (path: string) => WriteStream;
  readonly stat?: (path: string) => Promise<{ size: number }>;
}

const defaultCreateStream = (path: string): WriteStream =>
  createWriteStream(path, { flags: "a" });

export const createArchiveWriter = (deps: ArchiveWriterDeps = {}): ArchiveWriter => {
  const createStream = deps.createStream ?? defaultCreateStream;
  const statFile = deps.stat ?? stat;

  let stream: WriteStream | null = null;
  let closeResolve: (() => void) | null = null;
  let streamError: string | null = null;

  const recordError = (error: unknown): void => {
    streamError ??= error instanceof Error ? error.message : String(error);
  };

  return {
    open: (filePath: string): Promise<Result<void>> => {
      if (stream !== null) {
        return Promise.resolve(fail({ code: "UNKNOWN", message: "The archive is already open." }));
      }
      try {
        streamError = null;
        const opened = createStream(filePath);
        // A write stream with no error listener turns a failed write into an
        // uncaught exception, and main has no uncaughtException handler, so
        // a full disk or a deleted directory killed the whole tray app in
        // the middle of a meeting. Record it and let close report it.
        opened.on("error", (error: unknown) => {
          recordError(error);
        });
        stream = opened;
        return Promise.resolve(ok(undefined));
      } catch (error) {
        return Promise.resolve(
          fail({
            code: "UNKNOWN",
            message: error instanceof Error ? error.message : "Could not open the recording file."
          })
        );
      }
    },
    append: (bytes: ArrayBuffer): void => {
      if (stream === null) return;
      const buffer = Buffer.from(bytes);
      stream.write(buffer, (error) => {
        if (error !== null && error !== undefined) {
          recordError(error);
          console.warn("[meeting] Archive write failed.", error);
        }
      });
    },
    close: async (): Promise<number | null> => {
      const active = stream;
      stream = null;
      if (active === null) return streamError === null ? 0 : null;
      await new Promise<void>((resolve) => {
        closeResolve = resolve;
        active.end(() => {
          const settle = closeResolve;
          closeResolve = null;
          settle?.();
        });
      });
      // A size taken after a failed write describes a truncated file. It
      // must not pass for a complete recording, so the failure wins over
      // whatever bytes happen to be there.
      if (streamError !== null) return null;
      try {
        const stats = await statFile(active.path as string);
        return stats.size;
      } catch (error) {
        recordError(error);
        return null;
      }
    },
    isOpen: (): boolean => stream !== null,
    lastError: (): string | null => streamError
  };
};
