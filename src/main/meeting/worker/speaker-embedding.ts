interface EmbeddingStream {
  readonly acceptWaveform: (obj: { samples: Float32Array; sampleRate: number }) => void;
  readonly inputFinished: () => void;
}

interface EmbeddingExtractor {
  readonly createStream: () => EmbeddingStream;
  readonly compute: (stream: EmbeddingStream, enableExternalBuffer: boolean) => Float32Array;
}

/** Compute an owned embedding that remains valid after the native stream is released. */
export const computeSpeakerEmbedding = (
  extractor: EmbeddingExtractor,
  samples: Float32Array,
  sampleRate: number
): Float32Array => {
  const stream = extractor.createStream();
  stream.acceptWaveform({ samples, sampleRate });
  stream.inputFinished();
  return extractor.compute(stream, false);
};
