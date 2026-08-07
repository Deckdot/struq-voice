/**
 * One VAD lane: feeds an injected detector in exact window chunks (the
 * sherpa examples buffer the remainder between calls, which removes a class
 * of bug that only shows on some chunk alignments), carries partial windows
 * across calls, and forwards every completed utterance with an absolute
 * sample index. Pure logic with an injected detector, so it is unit tested
 * without the native module.
 */

export interface VadLaneOptions {
  readonly windowSize: number;
  readonly acceptWindow: (window: Float32Array) => void;
  readonly drainSegments: () => readonly { start: number; samples: Float32Array }[];
  readonly onUtterance: (utterance: {
    startSample: number;
    samples: Float32Array;
  }) => void;
}

export interface VadLane {
  pushInt16: (pcm: Int16Array) => void;
  flush: () => void;
}

/**
 * Int16 to the Float32 in [-1, 1] the detector expects, matching the
 * conversion parakeet.ts applies before decode.
 */
const toFloat32 = (pcm: Int16Array): Float32Array =>
  Float32Array.from(pcm, (value) => value / 32768);

export const createVadLane = (options: VadLaneOptions): VadLane => {
  const carry: number[] = [];

  const drain = (): void => {
    for (const segment of options.drainSegments()) {
      options.onUtterance({
        startSample: segment.start,
        samples: segment.samples
      });
    }
  };

  const pushFloat32 = (samples: Float32Array): void => {
    let offset = 0;
    while (samples.length - offset >= options.windowSize) {
      const window = samples.subarray(offset, offset + options.windowSize);
      offset += options.windowSize;
      options.acceptWindow(window);
    }
    if (offset < samples.length) {
      const tail = samples.subarray(offset);
      for (const sample of tail) {
        carry.push(sample);
      }
    }
    drain();
  };

  return {
    pushInt16: (pcm: Int16Array): void => {
      const converted = toFloat32(pcm);
      if (carry.length > 0) {
        const combined = new Float32Array(carry.length + converted.length);
        combined.set(Float32Array.from(carry));
        combined.set(converted, carry.length);
        carry.length = 0;
        pushFloat32(combined);
        return;
      }
      pushFloat32(converted);
    },
    flush: (): void => {
      // The detector is fed exact windows; the carry is always a partial one,
      // so pad it out to windowSize with silence. The detector's own flush
      // still surfaces whatever speech it has buffered internally.
      if (carry.length > 0) {
        const remainder = Float32Array.from(carry);
        carry.length = 0;
        if (remainder.length < options.windowSize) {
          const padded = new Float32Array(options.windowSize);
          padded.set(remainder);
          options.acceptWindow(padded);
        } else {
          options.acceptWindow(remainder);
        }
      }
      drain();
    }
  };
};
