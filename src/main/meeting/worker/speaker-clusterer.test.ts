import { describe, expect, it } from "vitest";
import { cosineSimilarity, createSpeakerClusterer } from "./speaker-clusterer";

/** A unit vector in direction `i`, so voices are exactly orthogonal. */
const unit = (i: number, size = 8): Float32Array => {
  const vector = new Float32Array(size);
  vector[i] = 1;
  return vector;
};

/** A vector near `i`, standing in for another utterance by the same voice. */
const near = (i: number, spread: number, size = 8): Float32Array => {
  const vector = new Float32Array(size);
  vector[i] = 1;
  vector[(i + 1) % size] = spread;
  return vector;
};

const identifying = { provisional: false } as const;
const short = { provisional: true } as const;

describe("cosineSimilarity", () => {
  it("returns 0 for a zero vector rather than NaN", () => {
    expect(cosineSimilarity(new Float32Array(8), unit(0))).toBe(0);
    expect(cosineSimilarity(new Float32Array(8), new Float32Array(8))).toBe(0);
  });
});

describe("speaker clusterer", () => {
  it("registers distinct voices as s1 and s2", () => {
    const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 0 });
    expect(clusterer.assign(unit(0), identifying)).toBe("s1");
    expect(clusterer.assign(unit(4), identifying)).toBe("s2");
    expect(clusterer.count()).toBe(2);
  });

  it("returns the existing key for a voice near one already heard", () => {
    const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 0 });
    clusterer.assign(unit(0), identifying);
    expect(clusterer.assign(near(0, 0.1), identifying)).toBe("s1");
    expect(clusterer.count()).toBe(1);
  });

  it("folds a third voice into the nearest speaker under maxSpeakers", () => {
    const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 2 });
    clusterer.assign(unit(0), identifying);
    clusterer.assign(unit(4), identifying);
    expect(clusterer.assign(near(0, 0.25), identifying)).toBe("s1");
    expect(clusterer.count()).toBe(2);
  });

  describe("short utterances", () => {
    it("never founds a speaker, however unlike everyone it sounds", () => {
      const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 0 });
      clusterer.assign(unit(0), identifying);
      // Orthogonal to the only speaker, so a bare nearest-centroid loop would
      // register a second one. This is the "mm-hm became Speaker 4" case.
      expect(clusterer.assign(unit(4), short)).toBe("s1");
      expect(clusterer.assign(unit(6), short)).toBe("s1");
      expect(clusterer.count()).toBe(1);
    });

    it("does not let a short utterance define a speaker", () => {
      const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 0 });
      clusterer.assign(unit(0), identifying);
      for (let i = 0; i < 20; i++) clusterer.assign(unit(4), short);
      // If those had been kept, the speaker would now look like unit(4) and a
      // genuine unit(4) voice would be folded in rather than recognised.
      expect(clusterer.assign(unit(4), identifying)).toBe("s2");
    });

    it("holds a label open when the meeting opens with a short utterance", () => {
      const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 0 });
      expect(clusterer.assign(unit(4), short)).toBe("s1");
      // The first identifiable voice adopts that label instead of becoming a
      // second speaker beside it.
      expect(clusterer.assign(unit(0), identifying)).toBe("s1");
      expect(clusterer.assign(near(0, 0.1), identifying)).toBe("s1");
      expect(clusterer.count()).toBe(1);
    });
  });

  describe("the ambiguous band", () => {
    it("joins the nearest speaker without being kept", () => {
      const clusterer = createSpeakerClusterer({
        threshold: 0.9,
        createThreshold: 0.2,
        maxSpeakers: 0
      });
      clusterer.assign(unit(0), identifying);
      // Scores about 0.6: too low to be confidently the same voice, too high
      // to be confidently a different one.
      expect(clusterer.assign(near(0, 0.8), identifying)).toBe("s1");
      expect(clusterer.count()).toBe(1);
      // Having not been kept, it did not drag the speaker toward itself.
      expect(clusterer.assign(unit(1), identifying)).toBe("s2");
    });

    it("still founds a speaker below the create threshold", () => {
      const clusterer = createSpeakerClusterer({
        threshold: 0.9,
        createThreshold: 0.5,
        maxSpeakers: 0
      });
      clusterer.assign(unit(0), identifying);
      expect(clusterer.assign(unit(4), identifying)).toBe("s2");
    });
  });

  describe("merging", () => {
    it("folds two speakers that turn out to be one voice", () => {
      const clusterer = createSpeakerClusterer({
        // High enough that the two founding utterances do not match each
        // other, so the same voice legitimately starts as two speakers.
        threshold: 0.95,
        createThreshold: 0.9,
        mergeThreshold: 0.6,
        maxSpeakers: 0
      });
      expect(clusterer.assign(near(0, 0.5), identifying)).toBe("s1");
      expect(clusterer.assign(near(0, 0.0), identifying)).toBe("s2");
      expect(clusterer.count()).toBe(2);

      // More of the same voice fills both rings until they plainly agree.
      clusterer.assign(near(0, 0.45), identifying);
      clusterer.assign(near(0, 0.05), identifying);

      expect(clusterer.count()).toBe(1);
      const merges = clusterer.takeMerges();
      expect(merges).toEqual([{ from: "s2", into: "s1" }]);
      // The older key survives, so the transcript keeps the label it has been
      // showing rather than swapping to a newer one.
      expect(clusterer.resolve("s2")).toBe("s1");
      expect(clusterer.aliases().get("s2")).toBe("s1");
    });

    it("reports each merge once", () => {
      const clusterer = createSpeakerClusterer({
        threshold: 0.95,
        createThreshold: 0.9,
        mergeThreshold: 0.6,
        maxSpeakers: 0
      });
      clusterer.assign(near(0, 0.5), identifying);
      clusterer.assign(near(0, 0.0), identifying);
      clusterer.assign(near(0, 0.45), identifying);
      clusterer.assign(near(0, 0.05), identifying);
      expect(clusterer.takeMerges()).toHaveLength(1);
      expect(clusterer.takeMerges()).toHaveLength(0);
    });

    it("keeps genuinely different voices apart", () => {
      const clusterer = createSpeakerClusterer({
        threshold: 0.5,
        mergeThreshold: 0.55,
        maxSpeakers: 0
      });
      for (let i = 0; i < 6; i++) {
        clusterer.assign(near(0, 0.05 * i), identifying);
        clusterer.assign(near(4, 0.05 * i), identifying);
      }
      expect(clusterer.count()).toBe(2);
      expect(clusterer.takeMerges()).toHaveLength(0);
    });

    it("resolves an unknown key to itself", () => {
      const clusterer = createSpeakerClusterer({ threshold: 0.5, maxSpeakers: 0 });
      expect(clusterer.resolve("s7")).toBe("s7");
    });
  });

  it("bounds memory by capping the exemplars held per speaker", () => {
    const clusterer = createSpeakerClusterer({
      threshold: 0.5,
      maxExemplars: 4,
      maxSpeakers: 0
    });
    for (let i = 0; i < 50; i++) {
      clusterer.assign(near(0, 0.01 * (i % 10)), identifying);
    }
    expect(clusterer.count()).toBe(1);
  });
});
