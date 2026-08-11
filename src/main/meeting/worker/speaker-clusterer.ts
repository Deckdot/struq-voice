/**
 * Incremental speaker clustering for one meeting.
 *
 * Offline diarization over a whole meeting is not an option: it wants every
 * sample in one array and clusters quadratically, so a three hour recording
 * is 690 MB before the algorithm starts. This assigns a label per utterance
 * in bounded time and bounded memory instead.
 *
 * A speaker is represented by a ring of recent embeddings rather than by one
 * running mean. The mean looks like the obvious choice and is what this module
 * used to do, but a speaker's embeddings are spread widely enough that their
 * average sits in the middle of nothing: measured on a two-voice fixture, one
 * voice split into two clusters whose means were only 0.494 apart, while two
 * genuinely different voices sat at 0.391. No threshold separates those. The
 * distance from a new utterance to its *nearest* previous utterances is far
 * better behaved, so scoring is the mean of the top few similarities against
 * the ring. Averaging the top few rather than taking the single best keeps
 * this from degenerating into single-linkage, where one freak match chains two
 * speakers together.
 *
 * Three further properties keep one voice from becoming several:
 *
 * 1. An utterance too short to fingerprint is *provisional*. Measured against
 *    a 10s reference of the same voice, CAM++ scores 0.05 at 300ms, 0.15 at
 *    1s and 0.89 at 8s, and same-speaker similarity does not stabilise until
 *    roughly three seconds. A provisional embedding may join the nearest
 *    speaker but may never found one and never enters a ring.
 * 2. There are two thresholds, not one. At or above `threshold` the voice is
 *    that speaker and the embedding is kept. Below `createThreshold` it is
 *    somebody new. Between them the answer is genuinely unknown, so it joins
 *    the nearest speaker without being kept, since an uncertain match is
 *    exactly what should not be used to define anybody.
 * 3. Speakers whose rings agree are merged. Streaming assignment is order
 *    dependent: two rings can be founded from opposite ends of one person's
 *    range and only later turn out to be the same voice. Merges are reported
 *    so already-emitted segments can be relabelled rather than left pointing
 *    at a retired key.
 */

export interface SpeakerAssignOptions {
  /**
   * True when the audio behind this embedding is too short to identify a
   * speaker. Such an embedding can join a speaker but never create or define
   * one.
   */
  readonly provisional: boolean;
}

export interface SpeakerMerge {
  /** The key that was retired. */
  readonly from: string;
  /** The key it was folded into. */
  readonly into: string;
}

export interface SpeakerClusterer {
  /** Returns the key for this voice, registering a new speaker if needed. */
  assign: (embedding: Float32Array, options?: SpeakerAssignOptions) => string;
  /**
   * Merges recorded since the last call, oldest first, and clears them. Main
   * uses these to rewrite segments it has already persisted.
   */
  takeMerges: () => SpeakerMerge[];
  /** Retired key to surviving key, for resolving a stale label. */
  aliases: () => ReadonlyMap<string, string>;
  /** Follows the alias chain from a possibly retired key to the live one. */
  resolve: (key: string) => string;
  /** Distinct surviving speakers. */
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

/** Mean of the highest `k` values, or of all of them when there are fewer. */
const topKMean = (scores: number[], k: number): number => {
  if (scores.length === 0) return -1;
  const sorted = [...scores].sort((a, b) => b - a);
  const take = Math.min(k, sorted.length);
  let sum = 0;
  for (let i = 0; i < take; i++) sum += sorted[i] ?? 0;
  return sum / take;
};

interface Speaker {
  key: string;
  /** Recent identifying embeddings. Bounded, so memory does not grow. */
  exemplars: Float32Array[];
  /** Next slot to overwrite once the ring is full. */
  cursor: number;
  /**
   * False for a speaker founded by a provisional embedding, which holds a
   * label but not yet a voice. The first identifiable utterance adopts it
   * instead of creating a second speaker beside it.
   */
  grounded: boolean;
}

export interface SpeakerClustererOptions {
  /** At or above this, the voice is that speaker and the embedding is kept. */
  readonly threshold: number;
  /**
   * Below this, the voice is someone new. Between this and `threshold` the
   * utterance joins the nearest speaker without being kept. Defaults to
   * `threshold` minus 0.15, which spans the band where same-speaker and
   * different-speaker scores overlap in practice.
   */
  readonly createThreshold?: number;
  /**
   * Mean cross-similarity above which two speakers are judged to be one voice
   * and merged. Not on the same scale as `threshold`: this averages every
   * pair across two rings rather than taking the best few against one, so it
   * sits lower even though it is the stronger claim.
   */
  readonly mergeThreshold?: number;
  /** How many embeddings represent a speaker. */
  readonly maxExemplars?: number;
  /** How many of the best matches are averaged into a score. */
  readonly topK?: number;
  /** 0 means the clustering decides how many speakers there are. */
  readonly maxSpeakers: number;
}

export const createSpeakerClusterer = (
  options: SpeakerClustererOptions
): SpeakerClusterer => {
  const createThreshold = options.createThreshold ?? Math.max(0, options.threshold - 0.15);
  const mergeThreshold = options.mergeThreshold ?? 0.55;
  const maxExemplars = options.maxExemplars ?? 24;
  const topK = options.topK ?? 3;

  const speakers: Speaker[] = [];
  const aliases = new Map<string, string>();
  const merges: SpeakerMerge[] = [];
  let created = 0;

  const resolve = (key: string): string => {
    let current = key;
    // Chains stay short (a merge target is itself a survivor), but a bound
    // keeps a corrupted map from spinning.
    for (let i = 0; i < speakers.length + 8 && aliases.has(current); i++) {
      current = aliases.get(current) ?? current;
    }
    return current;
  };

  const score = (embedding: Float32Array, speaker: Speaker): number =>
    topKMean(
      speaker.exemplars.map((exemplar) => cosineSimilarity(embedding, exemplar)),
      topK
    );

  const keep = (speaker: Speaker, embedding: Float32Array): void => {
    const owned = Float32Array.from(embedding);
    if (speaker.exemplars.length < maxExemplars) {
      speaker.exemplars.push(owned);
      return;
    }
    // Ring, so a long meeting tracks a voice as its channel drifts instead of
    // being anchored to the first minute.
    speaker.exemplars[speaker.cursor] = owned;
    speaker.cursor = (speaker.cursor + 1) % maxExemplars;
  };

  /**
   * Cross-similarity between two rings: every pair scored and averaged.
   *
   * Deliberately the mean and not the top-k used for assignment. Assignment
   * compares one embedding against a couple of dozen exemplars, where taking
   * the best few is the point. A ring against a ring is hundreds of pairs, and
   * the best few of those are the extreme tail of the distribution, which two
   * different speakers reach easily: scored that way a male and a female voice
   * agreed above 0.65 and were merged. The mean is what actually separates
   * them, at roughly 0.32 for different speakers against 0.75 for one voice
   * that split in two.
   */
  const agreement = (a: Speaker, b: Speaker): number => {
    if (a.exemplars.length === 0 || b.exemplars.length === 0) return -1;
    let sum = 0;
    let count = 0;
    for (const left of a.exemplars) {
      for (const right of b.exemplars) {
        sum += cosineSimilarity(left, right);
        count += 1;
      }
    }
    return count === 0 ? -1 : sum / count;
  };

  /**
   * Folds every pair of speakers that has turned out to be one voice. The
   * younger is always the one retired, so the surviving key is the one the
   * transcript has been showing for longest.
   */
  const mergeConverged = (): void => {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < speakers.length && !changed; i++) {
        for (let j = i + 1; j < speakers.length && !changed; j++) {
          const a = speakers[i];
          const b = speakers[j];
          if (a === undefined || b === undefined) continue;
          if (!a.grounded || !b.grounded) continue;
          if (agreement(a, b) < mergeThreshold) continue;

          for (const exemplar of b.exemplars) keep(a, exemplar);
          speakers.splice(j, 1);
          aliases.set(b.key, a.key);
          merges.push({ from: b.key, into: a.key });
          changed = true;
        }
      }
    }
  };

  const found = (embedding: Float32Array | null): string => {
    created += 1;
    const key = `s${String(created)}`;
    const speaker: Speaker = {
      key,
      exemplars: [],
      cursor: 0,
      grounded: embedding !== null
    };
    if (embedding !== null) keep(speaker, embedding);
    speakers.push(speaker);
    return key;
  };

  return {
    assign: (embedding, assignOptions) => {
      const provisional = assignOptions?.provisional ?? false;

      let best: Speaker | null = null;
      let bestScore = -1;
      for (const candidate of speakers) {
        const candidateScore = score(embedding, candidate);
        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          best = candidate;
        }
      }

      if (provisional) {
        // Too short to identify anyone: join the nearest speaker whatever the
        // score, and leave every ring untouched.
        if (best !== null) return best.key;
        // Nothing to join yet. Hold a label open; the first identifiable
        // utterance adopts it rather than becoming a second speaker.
        return found(null);
      }

      // An ungrounded speaker is a label waiting for a voice. Take it over
      // instead of founding a rival beside it.
      const ungrounded = speakers.find((speaker) => !speaker.grounded);
      if (ungrounded !== undefined && (best === null || bestScore < options.threshold)) {
        keep(ungrounded, embedding);
        ungrounded.grounded = true;
        mergeConverged();
        return ungrounded.key;
      }

      if (best !== null && bestScore >= options.threshold) {
        keep(best, embedding);
        mergeConverged();
        return best.key;
      }

      const capped = options.maxSpeakers > 0 && speakers.length >= options.maxSpeakers;
      if (best !== null && (bestScore >= createThreshold || capped)) {
        // The ambiguous band, or a hard cap. Take the nearest speaker but do
        // not let an uncertain match define them.
        return best.key;
      }

      return found(embedding);
    },
    takeMerges: () => merges.splice(0, merges.length),
    aliases: () => new Map(aliases),
    resolve,
    count: () => speakers.length
  };
};
