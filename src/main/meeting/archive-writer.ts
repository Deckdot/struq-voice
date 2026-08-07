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
  close: () => Promise<number>;
  isOpen: () => boolean;
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

  return {
    open: (filePath: string): Promise<Result<void>> => {
      if (stream !== null) {
        return Promise.resolve(fail({ code: "UNKNOWN", message: "The archive is already open." }));
      }
      try {
        stream = createStream(filePath);
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
        if (error !== null) {
          console.warn("[meeting] Archive write failed.", error);
        }
      });
    },
    close: async (): Promise<number> => {
      const active = stream;
      stream = null;
      if (active === null) return 0;
      await new Promise<void>((resolve) => {
        closeResolve = resolve;
        active.end(() => {
          const settle = closeResolve;
          closeResolve = null;
          settle?.();
        });
      });
      try {
        const stats = await statFile(active.path as string);
        return stats.size;
      } catch {
        return 0;
      }
    },
    isOpen: (): boolean => stream !== null
  };
};
