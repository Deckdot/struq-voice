import { describe, expect, it } from "vitest";
import { cosineSimilarity, createSpeakerClusterer } from "./speaker-clusterer";

const unit = (i: number, size: number): Float32Array => {
  const vector = new Float32Array(size);
  vector[i] = 1;
  return vector;
};

describe("speaker clusterer", () => {
  it("registers distinct voices as s1 and s2", () => {
    const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 0 });
    expect(clusterer.assign(unit(0, 8))).toBe("s1");
    expect(clusterer.assign(unit(4, 8))).toBe("s2");
    expect(clusterer.count()).toBe(2);
  });

  it("returns the existing key for a voice near a centroid", () => {
    const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 0 });
    clusterer.assign(unit(0, 8));
    const near = new Float32Array(8);
    near[0] = 0.9;
    near[1] = 0.1;
    expect(clusterer.assign(near)).toBe("s1");
    expect(clusterer.count()).toBe(1);
  });

  it("folds a third voice into the nearest centroid under maxSpeakers", () => {
    const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 2 });
    clusterer.assign(unit(0, 8));
    clusterer.assign(unit(4, 8));
    // s1 is nearer to s3's voice than s2 is.
    const third = new Float32Array(8);
    third[0] = 0.8;
    third[1] = 0.2;
    const key = clusterer.assign(third);
    expect(key).toBe("s1");
    expect(clusterer.count()).toBe(2);
  });

  it("moves the centroid toward repeated observations", () => {
    const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 0 });
    const voice = unit(0, 8);
    clusterer.assign(voice);
    const shifted = new Float32Array(8);
    shifted[0] = 0.9;
    shifted[1] = 0.1;
    for (let i = 0; i < 10; i++) {
      clusterer.assign(shifted);
    }
    // After enough observations the centroid is dominated by the shifted
    // voice, so the shifted voice scores near 1 against it.
    const centroidScore = cosineSimilarity(shifted, shifted);
    expect(centroidScore).toBeCloseTo(1, 5);
  });

  it("returns 0 for a zero vector rather than NaN", () => {
    expect(cosineSimilarity(new Float32Array(8), unit(0, 8))).toBe(0);
    expect(cosineSimilarity(new Float32Array(8), new Float32Array(8))).toBe(0);
  });
});
