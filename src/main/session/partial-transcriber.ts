/**
 * The live transcript driver.
 *
 * While a capture is open this periodically copies the audio recorded so far
 * and re-decodes it, so the user can see that what they said was heard. It is
 * feedback, not delivery: the transcript that actually gets pasted is always
 * the final pass in capture-session.ts.
 *
 * That distinction drives every rule here:
 *
 * - The hot path wins. A partial never delays, blocks or cancels the final
 *   transcription, and `stop()` abandons any decode still in flight rather
 *   than awaiting it.
 * - One decode at a time. If a tick arrives while the previous decode is
 *   still running it is skipped, so a slow engine degrades to fewer updates
 *   instead of an unbounded queue.
 * - Late results are dropped. Each pass carries the sequence it started
 *   under; anything from a superseded capture is discarded on return.
 * - Off by default (see `liveTranscription` in settings). Re-decoding costs
 *   real CPU, and on a slow machine that competes with the pass that matters.
 */

import type { Result } from "../../shared/result";
import type { CaptureAudio } from "./audio-source";
import type { TranscribeResult } from "../engines/types";

export interface PartialTranscriberOptions {
  /** How often to re-decode while listening (ms). */
  readonly intervalMs: number;
  /** Give up on a snapshot that does not arrive in this long (ms). */
  readonly snapshotTimeoutMs: number;
  /** Skip a pass whose audio is shorter than this: too little to decode. */
  readonly minAudioMs: number;
  /** Copy the audio captured so far, or null when unavailable. */
  readonly snapshot: (timeoutMs: number) => Promise<CaptureAudio | null>;
  /** Decode a partial. Aborted through the signal when the capture ends. */
  readonly transcribe: (
    audio: CaptureAudio,
    signal: AbortSignal
  ) => Promise<Result<TranscribeResult>>;
  /** Called with each accepted partial, in order. */
  readonly onPartial: (partial: {
    text: string;
    durationMs: number;
    sequence: number;
  }) => void;
}

export interface PartialTranscriber {
  /** Begin partial decoding for a new capture. */
  start: () => void;
  /** End the current capture and abandon any decode in flight. */
  stop: () => void;
  /** True while a capture is open. */
  isRunning: () => boolean;
}

export const createPartialTranscriber = (
  options: PartialTranscriberOptions
): PartialTranscriber => {
  let timer: ReturnType<typeof setInterval> | null = null;
  let controller: AbortController | null = null;
  let decoding = false;
  let captureId = 0;
  let sequence = 0;

  const runPass = async (activeCapture: number): Promise<void> => {
    // One decode at a time: a slow engine loses updates, never queues them.
    if (decoding) return;
    decoding = true;

    try {
      const audio = await options.snapshot(options.snapshotTimeoutMs);
      if (audio === null) return;
      if (captureId !== activeCapture) return;
      if (audio.durationMs < options.minAudioMs) return;

      const active = controller;
      if (active === null || active.signal.aborted) return;

      const outcome = await options.transcribe(audio, active.signal);

      // The capture may have ended, or a newer one begun, while decoding.
      // Re-read the signal through the controller: stop() aborts it during the
      // await above, which narrowing from before the await cannot see.
      if (captureId !== activeCapture) return;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- stop() aborts this signal during the await above, which narrowing from the pre-await check cannot see. Removing this guard fails the "drops a decode aborted mid-flight" test.
      if (active.signal.aborted) return;
      if (!outcome.ok) return;

      const text = outcome.value.text.trim();
      if (text.length === 0) return;

      sequence += 1;
      options.onPartial({
        text,
        durationMs: audio.durationMs,
        sequence
      });
    } catch {
      // A partial is cosmetic. A failed pass is skipped in silence; the next
      // tick tries again, and the final transcription is unaffected.
    } finally {
      decoding = false;
    }
  };

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    // Abandon rather than await: the final transcription must not wait on a
    // decode that only ever fed the panel.
    controller?.abort();
    controller = null;
    captureId += 1;
    decoding = false;
  };

  return {
    start: (): void => {
      stop();
      captureId += 1;
      sequence = 0;
      controller = new AbortController();
      const activeCapture = captureId;
      timer = setInterval(() => {
        void runPass(activeCapture);
      }, options.intervalMs);
    },
    stop,
    isRunning: (): boolean => timer !== null
  };
};
