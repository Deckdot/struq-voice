import { describe, expect, it, vi } from "vitest";
import { computeSpeakerEmbedding } from "./speaker-embedding";

describe("speaker embedding", () => {
  it("requests an owned buffer from sherpa", () => {
    const acceptWaveform = vi.fn();
    const inputFinished = vi.fn();
    const stream = { acceptWaveform, inputFinished };
    const embedding = new Float32Array([0.1, 0.2]);
    const compute = vi.fn(() => embedding);
    const extractor = { createStream: vi.fn(() => stream), compute };
    const samples = new Float32Array([0.25, -0.25]);

    expect(computeSpeakerEmbedding(extractor, samples, 16000)).toBe(embedding);
    expect(acceptWaveform).toHaveBeenCalledWith({ samples, sampleRate: 16000 });
    expect(inputFinished).toHaveBeenCalledOnce();
    expect(compute).toHaveBeenCalledWith(stream, false);
  });
});
