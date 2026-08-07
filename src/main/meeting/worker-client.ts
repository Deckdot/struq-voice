/**
 * Owns the meeting transcription utilityProcess lifecycle: fork, message
 * relay, drain, kill. Injected into the meeting session so the session can be
 * unit tested against a fake.
 */

import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { Result } from "../../shared/result";
import { fail, ok } from "../../shared/result";
import type { WorkerCommand, WorkerEvent, WorkerInit } from "./worker/protocol";

const START_TIMEOUT_MS = 30_000;
const WORKER_PATH = join(__dirname, "meeting-worker.cjs");

export interface MeetingWorkerClient {
  start: (init: WorkerInit) => Promise<Result<void>>;
  sendFrames: (frames: WorkerCommand & { readonly type: "frames" }) => void;
  setYielding: (yielding: boolean) => void;
  /** Resolves when the worker reports drained, or after timeoutMs. */
  drain: (timeoutMs: number) => Promise<void>;
  kill: () => void;
  onEvent: (listener: (event: WorkerEvent) => void) => () => void;
}

export const createMeetingWorkerClient = (): MeetingWorkerClient => {
  let child: UtilityProcess | null = null;
  let startResolve: ((result: Result<void>) => void) | null = null;
  let drainResolve: (() => void) | null = null;
  let killRequested = false;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(event: WorkerEvent) => void>();

  const emit = (event: WorkerEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const onExit = (): void => {
    const settle = startResolve;
    startResolve = null;
    if (settle !== null) {
      settle(fail({ code: "UNKNOWN", message: "The meeting worker exited before it became ready." }));
    }
    const drain = drainResolve;
    drainResolve = null;
    drain?.();
    if (!killRequested) {
      // An unexpected exit ends the meeting: crash isolation means the app
      // survives, but there is no audio pipeline left to transcribe with.
      emit({ type: "failure", code: "engine-not-ready", message: "The meeting worker exited unexpectedly." });
    }
    child = null;
  };

  return {
    start: (init: WorkerInit): Promise<Result<void>> => {
      if (child !== null) {
        return Promise.resolve(fail({ code: "UNKNOWN", message: "The meeting worker is already running." }));
      }
      killRequested = false;
      child = utilityProcess.fork(WORKER_PATH, [], { serviceName: "struq-meeting" });
      child.postMessage(init);
      child.on("message", (event) => {
        const workerEvent = event as WorkerEvent;
        if (workerEvent.type === "ready") {
          const settle = startResolve;
          startResolve = null;
          settle?.(ok(undefined));
        } else if (workerEvent.type === "failure") {
          const settle = startResolve;
          startResolve = null;
          settle?.(fail({ code: "UNKNOWN", message: workerEvent.message }));
        } else if (workerEvent.type === "drained") {
          const settle = drainResolve;
          drainResolve = null;
          if (drainTimer !== null) {
            clearTimeout(drainTimer);
            drainTimer = null;
          }
          settle?.();
        }
        emit(workerEvent);
      });
      child.on("exit", onExit);

      return new Promise<Result<void>>((resolve) => {
        startResolve = resolve;
        setTimeout(() => {
          // A cold Parakeet warmup on a slow disk is genuinely slow.
          const settle = startResolve;
          startResolve = null;
          if (settle !== null) {
            settle(fail({ code: "UNKNOWN", message: "The meeting worker took too long to start." }));
          }
        }, START_TIMEOUT_MS);
      });
    },
    sendFrames: (frames): void => {
      child?.postMessage(frames);
    },
    setYielding: (yielding): void => {
      child?.postMessage({ type: "yield", yielding } satisfies WorkerCommand);
    },
    drain: (timeoutMs: number): Promise<void> => {
      if (child === null) {
        return Promise.resolve();
      }
      child.postMessage({ type: "drain" } satisfies WorkerCommand);
      return new Promise<void>((resolve) => {
        drainResolve = resolve;
        drainTimer = setTimeout(() => {
          drainResolve = null;
          resolve();
        }, timeoutMs);
      });
    },
    kill: (): void => {
      killRequested = true;
      if (drainTimer !== null) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
      child?.kill();
      child = null;
    },
    onEvent: (listener): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};
