import { describe, expect, it, vi } from "vitest";
import { drainVadSegments } from "./vad-segments";

describe("VAD segment draining", () => {
  it("requests copied buffers from sherpa", () => {
    let remaining = 1;
    const segment = { start: 0, samples: new Float32Array([0.25]) };
    const front = vi.fn(() => segment);
    const vad = {
      isEmpty: (): boolean => remaining === 0,
      front,
      pop: (): void => {
        remaining -= 1;
      }
    };

    expect(drainVadSegments(vad)).toEqual([segment]);
    expect(front).toHaveBeenCalledWith(false);
  });
});
