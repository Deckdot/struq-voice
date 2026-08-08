/**
 * Microphone meter response, shared by every surface that shows input level:
 * Dictate, the Capture settings tab and onboarding.
 *
 * The raw value from the analyser is linear RMS amplitude. Speech at a normal
 * distance sits around 0.02 to 0.1 there, so drawing it linearly left the bar
 * in the bottom few percent and looked like a microphone that was not working.
 * Loudness is perceived logarithmically, which is why every meter that reads
 * correctly is drawn on a dB scale, so that is what these do.
 */

/** Below this the signal is treated as silence rather than a very small bar. */
const SILENCE_FLOOR = 0.0004;
/** Amplitude range the bar spans, in dB. -60dB is a quiet room. */
const RANGE_DB = 60;

/**
 * Linear RMS amplitude (0..1) to bar fill (0..1) on a dB scale.
 *
 * Quiet speech lands near the middle of the bar instead of pinned at the
 * bottom, and the top of the bar still means genuinely loud.
 */
export const micLevelToBar = (rms: number): number => {
  if (!Number.isFinite(rms) || rms <= SILENCE_FLOOR) return 0;
  const db = 20 * Math.log10(Math.min(1, rms));
  return Math.min(1, Math.max(0, (db + RANGE_DB) / RANGE_DB));
};

/**
 * Fold a new reading into the displayed one: jump to a louder value at once,
 * fall back gradually.
 *
 * A meter that rises slowly reads as laggy, and one that falls instantly
 * flickers on every syllable gap. The previous smoothing multiplied the input
 * by 0.4 on the way in, so the bar could never reach the level it was given
 * even when held steady.
 */
export const smoothMicLevel = (current: number, next: number): number =>
  next > current ? next : current * 0.82 + next * 0.18;
