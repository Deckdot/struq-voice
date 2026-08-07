/**
 * Diarization refinement for one long utterance, as a pure function so the
 * slice math and the same-speaker merge are unit tested without the native
 * module.
 *
 * A VAD utterance longer than the refinement threshold is likely two people
 * talking over each other with no pause. Offline diarization splits it into
 * sub-segments; each sub-segment is embedded, assigned to an incremental
 * speaker cluster, and adjacent sub-segments that land on the same speaker
 * are merged so one continuous turn is one line rather than three.
 */

export interface DiarizedSubSegment {
  /** Seconds, relative to the start of the samples array. */
  readonly start: number;
  readonly end: number;
}

export interface RefinedSegment {
  readonly startSample: number;
  readonly samples: Float32Array;
  readonly key: string;
}

export interface RefineLongTurnDeps {
  /** Absolute sample index where this utterance begins in the meeting. */
  readonly utteranceStartSample: number;
  readonly samples: Float32Array;
  readonly sampleRate: number;
  /** Sub-segments shorter than this (seconds) are dropped. */
  readonly minSubSegmentSeconds: number;
  readonly diarizer: {
    readonly process: (samples: Float32Array) => readonly DiarizedSubSegment[];
  } | null;
  readonly clusterer: { readonly assign: (embedding: Float32Array) => string } | null;
  readonly embed: (samples: Float32Array) => Float32Array;
}

/**
 * Splits a long utterance on the diarizer output and merges adjacent
 * sub-segments onto the same speaker. Both `startSample` (absolute) and the
 * sub-segment slices (relative to the utterance) are computed from the same
 * seconds, so a sub-segment is always sliced against its own span, never
 * shifted by the utterance's position in the meeting.
 */
export const refineLongTurn = (deps: RefineLongTurnDeps): RefinedSegment[] => {
  const { utteranceStartSample, samples, sampleRate, diarizer, clusterer, embed } = deps;

  if (diarizer === null || clusterer === null) {
    const key = clusterer?.assign(embed(samples)) ?? "s1";
    return [{ startSample: utteranceStartSample, samples, key }];
  }

  const merged: RefinedSegment[] = [];
  let current: RefinedSegment | null = null;

  for (const sub of diarizer.process(samples)) {
    if (sub.end - sub.start < deps.minSubSegmentSeconds) continue;
    const startSample = utteranceStartSample + Math.round(sub.start * sampleRate);
    const endSample = utteranceStartSample + Math.round(sub.end * sampleRate);
    const slice = samples.subarray(
      startSample - utteranceStartSample,
      endSample - utteranceStartSample
    );
    const key = clusterer.assign(embed(slice));
    if (current !== null && current.key === key) {
      const combined: Float32Array = new Float32Array(current.samples.length + slice.length);
      combined.set(current.samples);
      combined.set(slice, current.samples.length);
      // The previous object was pushed into merged; replace that slot so the
      // combined audio actually reaches the array.
      current = { startSample: current.startSample, samples: combined, key };
      merged[merged.length - 1] = current;
    } else {
      current = { startSample, samples: slice, key };
      merged.push(current);
    }
  }

  if (merged.length === 0) {
    const key = clusterer.assign(embed(samples));
    return [{ startSample: utteranceStartSample, samples, key }];
  }
  return merged;
};
