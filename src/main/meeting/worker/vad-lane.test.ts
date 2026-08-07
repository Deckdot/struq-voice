import { describe, expect, it } from "vitest";
import { createVadLane } from "./vad-lane";

interface FakeSegment {
  readonly start: number;
  readonly samples: Float32Array;
}

/**
 * A fake VAD that reports one segment per accepted window once every
 * WINDOWS_PER_SEGMENT windows, with a running absolute start index. This is
 * what makes the lane tests about the lane logic, not about Silero.
 */
const makeFakeVad = (
  windowSize: number,
  windowsPerSegment: number
): {
  readonly accepted: Float32Array[];
  readonly drainSegments: () => FakeSegment[];
  readonly feed: (window: Float32Array) => void;
} => {
  const accepted: Float32Array[] = [];
  let samplesSinceSegment = 0;
  let segmentCount = 0;
  return {
    accepted,
    feed: (window: Float32Array) => {
      accepted.push(window);
      samplesSinceSegment += window.length;
    },
    drainSegments: (): FakeSegment[] => {
      const out: FakeSegment[] = [];
      while (samplesSinceSegment >= windowSize * windowsPerSegment) {
        const start = segmentCount * windowSize * windowsPerSegment;
        const samples = new Float32Array(windowSize * windowsPerSegment);
        for (let i = 0; i < samples.length; i++) {
          samples[i] = 0.5;
        }
        out.push({ start, samples });
        samplesSinceSegment -= windowSize * windowsPerSegment;
        segmentCount += 1;
      }
      return out;
    }
  };
};

describe("vad lane", () => {
  it("carries partial windows across push calls", () => {
    const windowSize = 512;
    const vad = makeFakeVad(windowSize, 4);
    const utterances: { startSample: number; samples: Float32Array }[] = [];
    const lane = createVadLane({
      windowSize,
      acceptWindow: (window) => {
        vad.feed(window);
      },
      drainSegments: () => vad.drainSegments(),
      onUtterance: (utterance) => {
        utterances.push(utterance);
      }
    });

    // 1000 samples: one full window plus a 488-sample carry.
    const first = new Int16Array(1000);
    lane.pushInt16(first);
    expect(vad.accepted).toHaveLength(1);
    expect(utterances).toHaveLength(0);

    // The remaining 488 plus 24 more complete a second window; the carry
    // must have been prepended, not dropped.
    const second = new Int16Array(24);
    lane.pushInt16(second);
    expect(vad.accepted).toHaveLength(2);
    expect(vad.accepted[1]?.length).toBe(512);
  });

  it("reports absolute sample indices for the meeting timeline", () => {
    const windowSize = 512;
    const vad = makeFakeVad(windowSize, 2);
    const utterances: { startSample: number; samples: Float32Array }[] = [];
    const lane = createVadLane({
      windowSize,
      acceptWindow: (window) => {
        vad.feed(window);
      },
      drainSegments: () => vad.drainSegments(),
      onUtterance: (utterance) => {
        utterances.push(utterance);
      }
    });

    // Four windows: two segments at absolute starts 0 and 1024.
    lane.pushInt16(new Int16Array(windowSize * 4));
    expect(utterances).toHaveLength(2);
    expect(utterances[0]?.startSample).toBe(0);
    expect(utterances[1]?.startSample).toBe(1024);
    expect(utterances[1]?.samples.length).toBe(1024);
  });

  it("emits nothing for a silent lane", () => {
    const windowSize = 512;
    const vad = makeFakeVad(windowSize, 2);
    const utterances: { startSample: number; samples: Float32Array }[] = [];
    const lane = createVadLane({
      windowSize,
      acceptWindow: (window) => {
        vad.feed(window);
      },
      drainSegments: () => [],
      onUtterance: (utterance) => {
        utterances.push(utterance);
      }
    });

    lane.pushInt16(new Int16Array(windowSize * 4));
    lane.flush();
    expect(utterances).toHaveLength(0);
  });

  it("flushes the carry as a final partial window", () => {
    const windowSize = 512;
    const vad = makeFakeVad(windowSize, 2);
    const accepted: Float32Array[] = [];
    const lane = createVadLane({
      windowSize,
      acceptWindow: (window) => {
        accepted.push(window);
        vad.feed(window);
      },
      drainSegments: () => vad.drainSegments(),
      onUtterance: () => {}
    });

    lane.pushInt16(new Int16Array(600));
    expect(accepted).toHaveLength(1);
    lane.flush();
    expect(accepted).toHaveLength(2);
    expect(accepted[1]?.length).toBe(88);
  });
});
