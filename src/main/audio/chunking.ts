/**
 * Splitting a long recording into pieces a cloud provider will accept.
 *
 * Local engines decode a whole capture in one pass, which is what keeps
 * punctuation and casing coherent across sentence boundaries. A cloud
 * transcription endpoint cannot: the request has an upload size limit, and a
 * single very long upload turns one flaky connection into a total loss of the
 * recording. So cloud requests are chunked, and only cloud requests.
 *
 * Where the cut lands matters more than how many there are. Cutting mid-word
 * costs that word twice, once truncated at the end of one chunk and once
 * truncated at the start of the next, so each boundary is nudged to the
 * quietest short window within a search band ending at the target. Silence is
 * where a person pauses, and a pause is a free place to cut.
 *
 * Pure and side-effect free: the planner returns sample ranges and never
 * touches the audio.
 */

export interface PcmChunk {
  /** Inclusive start sample index. */
  readonly start: number;
  /** Exclusive end sample index. */
  readonly end: number;
}

export interface ChunkPlanOptions {
  readonly sampleRate: number;
  /** Aim for chunks about this long. */
  readonly targetMs: number;
  /** Never emit a chunk longer than this. */
  readonly maxMs: number;
  /** Look this far back from the target for a quiet place to cut. */
  readonly searchMs: number;
  /** Width of the window scored for quietness. */
  readonly windowMs: number;
}

export const DEFAULT_CHUNK_PLAN: Omit<ChunkPlanOptions, "sampleRate"> = {
  targetMs: 120_000,
  maxMs: 150_000,
  searchMs: 20_000,
  windowMs: 300
};

/** Mean absolute amplitude over [from, to). Cheap, and enough to rank pauses. */
const windowEnergy = (pcm: Int16Array, from: number, to: number): number => {
  let total = 0;
  for (let i = from; i < to; i++) {
    total += Math.abs(pcm[i] ?? 0);
  }
  const width = to - from;
  return width === 0 ? 0 : total / width;
};

/**
 * Plan the cut points for one recording. Audio at or under `maxMs` is
 * returned as a single chunk, which is the case that must stay free: the
 * overwhelming majority of dictations are seconds long and never reach here.
 */
export const planChunks = (
  pcm: Int16Array,
  options: ChunkPlanOptions
): readonly PcmChunk[] => {
  const { sampleRate } = options;
  if (pcm.length === 0) return [];
  const maxSamples = Math.max(1, Math.floor((sampleRate * options.maxMs) / 1000));
  if (pcm.length <= maxSamples) {
    return [{ start: 0, end: pcm.length }];
  }

  const targetSamples = Math.max(
    1,
    Math.floor((sampleRate * options.targetMs) / 1000)
  );
  const searchSamples = Math.max(
    0,
    Math.floor((sampleRate * options.searchMs) / 1000)
  );
  const windowSamples = Math.max(
    1,
    Math.floor((sampleRate * options.windowMs) / 1000)
  );

  const chunks: PcmChunk[] = [];
  let start = 0;

  while (start < pcm.length) {
    const remaining = pcm.length - start;
    if (remaining <= maxSamples) {
      chunks.push({ start, end: pcm.length });
      break;
    }

    const target = start + targetSamples;
    const searchFrom = Math.max(start + windowSamples, target - searchSamples);
    const searchTo = Math.min(start + maxSamples, pcm.length);

    let cut = Math.min(target, searchTo);
    let quietest = Number.POSITIVE_INFINITY;
    // Step by the window width: sample the band rather than scoring every
    // offset in it, which on ten minutes of audio is the difference between
    // a few hundred windows and several million.
    for (let at = searchFrom; at + windowSamples <= searchTo; at += windowSamples) {
      const energy = windowEnergy(pcm, at, at + windowSamples);
      if (energy < quietest) {
        quietest = energy;
        // Cut in the middle of the quiet window, so neither side inherits
        // the edge of the pause.
        cut = at + Math.floor(windowSamples / 2);
      }
    }

    // A degenerate search band (a very short target next to a long max) must
    // still make progress, or this loop never terminates.
    if (cut <= start) cut = Math.min(start + maxSamples, pcm.length);
    chunks.push({ start, end: cut });
    start = cut;
  }

  return chunks;
};
