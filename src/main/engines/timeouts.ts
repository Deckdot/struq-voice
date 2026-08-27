/**
 * How long a transcription is allowed to run before it is abandoned.
 *
 * Inference time scales with the length of the recording, so a fixed budget
 * is only ever correct for one length. The 20 second local budget this
 * replaced was generous for a ten second note and guaranteed failure for a
 * five minute one: the abort fired mid-decode, the engine reported a
 * cancellation, and five minutes of speech were gone with nothing on the
 * clipboard to recover.
 *
 * A budget is therefore a fixed allowance (model load, process spawn,
 * connection and upload) plus a multiple of the audio's own duration. The
 * multiples are far slower than any engine this app ships, so the timeout
 * only ever catches a decode that is genuinely stuck rather than one that is
 * merely working through a long recording.
 *
 * The ceiling exists because the transcribing phase has no cancel: a hung
 * engine must eventually release the session rather than hold it forever.
 */

/** Model load, process spawn and the first frames of decode. */
const LOCAL_BASE_MS = 30_000;
/**
 * Whisper's larger builds decode slower than realtime on a CPU without CUDA,
 * so the local multiple has to sit well above 1. Parakeet, the default, runs
 * at roughly a tenth of this.
 */
const LOCAL_REALTIME_FACTOR = 6;

/** Connection, upload of the WAV, and provider-side queueing. */
const CLOUD_BASE_MS = 60_000;
/** Upload plus the provider's own decode, which is not ours to control. */
const CLOUD_REALTIME_FACTOR = 3;

/** No single request waits longer than this, however long the recording is. */
export const MAX_TRANSCRIBE_TIMEOUT_MS = 10 * 60_000;

/**
 * The budget for one transcription request. `durationMs` is the length of the
 * audio being decoded, not of the whole capture: the hot path trims silence
 * first, and a chunked cloud request passes the chunk it is sending.
 */
export const transcribeTimeoutMs = (
  kind: "local" | "cloud",
  durationMs: number
): number => {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(durationMs, 0) : 0;
  const budget =
    kind === "cloud"
      ? CLOUD_BASE_MS + safeDuration * CLOUD_REALTIME_FACTOR
      : LOCAL_BASE_MS + safeDuration * LOCAL_REALTIME_FACTOR;
  return Math.min(Math.round(budget), MAX_TRANSCRIBE_TIMEOUT_MS);
};
