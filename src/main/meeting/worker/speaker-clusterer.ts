/**
 * Incremental speaker clustering for one meeting.
 *
 * Offline diarization over a whole meeting is not an option: it wants every
 * sample in one array and clusters quadratically, so a three hour recording
 * is 690 MB before the algorithm starts. This assigns a label per utterance
 * in constant time and constant memory instead, by keeping one running
 * centroid per speaker and comparing new embeddings against them.
 */

export interface SpeakerClusterer {
  /** Returns the key for this voice, registering a new speaker if needed. */
  assign: (embedding: Float32Array) => string;
  count: () => number;
}

export const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const createSpeakerClusterer = (options: {
  readonly threshold: number;
  /** 0 means the clustering decides how many speakers there are. */
  readonly maxSpeakers: number;
}): SpeakerClusterer => {
  const centroids: { key: string; vector: Float32Array; observations: number }[] = [];

  return {
    assign: (embedding) => {
      let best: (typeof centroids)[number] | null = null;
      let bestScore = -1;
      for (const candidate of centroids) {
        const score = cosineSimilarity(embedding, candidate.vector);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }

      const capped =
        options.maxSpeakers > 0 && centroids.length >= options.maxSpeakers;

      if (best !== null && (bestScore >= options.threshold || capped)) {
        // Running mean: the centroid sharpens as the meeting goes on, and one
        // odd utterance cannot drag an established speaker.
        const next = best.observations + 1;
        for (let i = 0; i < best.vector.length; i++) {
          const previous = best.vector[i] ?? 0;
          best.vector[i] = previous + ((embedding[i] ?? 0) - previous) / next;
        }
        best.observations = next;
        return best.key;
      }

      const key = `s${String(centroids.length + 1)}`;
      centroids.push({
        key,
        vector: Float32Array.from(embedding),
        observations: 1
      });
      return key;
    },
    count: () => centroids.length
  };
};
