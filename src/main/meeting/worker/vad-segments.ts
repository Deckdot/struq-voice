export interface VadSegment {
  readonly start: number;
  readonly samples: Float32Array;
}

interface VadSegmentQueue {
  readonly isEmpty: () => boolean;
  readonly front: (enableExternalBuffer: boolean) => VadSegment;
  readonly pop: () => void;
}

/** Copy detected speech out of the native VAD before its next mutation. */
export const drainVadSegments = (vad: VadSegmentQueue): VadSegment[] => {
  const segments: VadSegment[] = [];
  while (!vad.isEmpty()) {
    segments.push(vad.front(false));
    vad.pop();
  }
  return segments;
};
