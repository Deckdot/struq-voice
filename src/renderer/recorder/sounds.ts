/**
 * Capture sounds, played from the recorder window.
 *
 * This window is hidden, permanently alive and already owns an AudioContext,
 * which makes it the only sane place for this: nothing here can touch the
 * foreground, and a capture sound must never disturb the window the transcript
 * is about to be pasted into.
 *
 * Decoded buffers are cached by identity, so the open and close sounds are
 * decoded once per session rather than on every capture. The sound is meant to
 * confirm the key registered, so a decode in the hot path would defeat it.
 */

const cache = new Map<string, AudioBuffer>();

let context: AudioContext | null = null;

/**
 * Playback gets its own context at the default device rate, not the capture
 * pipeline's. That one is pinned to 16kHz because it feeds the speech models,
 * and decodeAudioData resamples to the context rate: playing a 44.1kHz sound
 * through it would throw away most of the sound's bandwidth and make a crisp
 * chirp sound muffled.
 */
const ensureContext = (): AudioContext | null => {
  if (context !== null && context.state !== "closed") return context;
  try {
    context = new AudioContext();
    return context;
  } catch {
    context = null;
    return null;
  }
};

const cacheKey = (bytes: ArrayBuffer): string =>
  `${String(bytes.byteLength)}:${new Uint8Array(bytes, 0, Math.min(32, bytes.byteLength)).join(",")}`;

/**
 * Play one capture sound. Failures are swallowed: a missing or unreadable
 * sound file must never interfere with a capture, which is the actual job.
 */
export const playCaptureSound = async (
  bytes: ArrayBuffer,
  volume: number
): Promise<void> => {
  const audio = ensureContext();
  if (audio === null) return;

  try {
    // A suspended context produces silence without erroring, which would look
    // like a broken sound rather than a blocked one.
    if (audio.state === "suspended") {
      await audio.resume();
    }

    const key = cacheKey(bytes);
    let buffer = cache.get(key);
    if (buffer === undefined) {
      // decodeAudioData detaches the buffer it is given, so decode a copy:
      // the cache key was computed from the original and a retry would
      // otherwise read a detached buffer.
      buffer = await audio.decodeAudioData(bytes.slice(0));
      cache.set(key, buffer);
    }

    const source = audio.createBufferSource();
    source.buffer = buffer;
    const gain = audio.createGain();
    gain.gain.value = Math.min(1, Math.max(0, volume));
    source.connect(gain);
    gain.connect(audio.destination);
    source.start();
  } catch {
    // Nothing to do and nothing worth reporting: the capture still works.
  }
};
