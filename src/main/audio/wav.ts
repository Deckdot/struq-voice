/**
 * WAV container and silence trimming. Pure functions, unit tested.
 * The hot path writes nothing to disk: WAV bytes are built in memory and
 * handed to the engines (or kept for verification).
 */

/**
 * Build a 16-bit PCM mono WAV from Int16 samples. RIFF header, fmt chunk,
 * data chunk, little-endian throughout.
 */
export const buildWav = (pcm: Int16Array, sampleRate: number): Buffer => {
  const bytesPerSample = 2;
  const dataSize = pcm.byteLength;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buffer, 44);
  return buffer;
};

export const isWav = (bytes: Buffer): boolean =>
  bytes.length >= 12 &&
  bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
  bytes.subarray(8, 12).toString("ascii") === "WAVE";

export const wavDurationMs = (bytes: Buffer, sampleRate: number): number => {
  if (!isWav(bytes)) return 0;
  const dataSize = bytes.readUInt32LE(40);
  return Math.round((dataSize / 2 / sampleRate) * 1000);
};

/**
 * Find the first and last sample above the silence threshold. Returns
 * [start, end] indices inclusive; an all-silent buffer returns [0, 0].
 * The `minKeepMs` guard keeps a tiny margin around speech so a loud room
 * or a clipped syllable does not zero out the whole clip.
 */
export const trimSilence = (
  pcm: Int16Array,
  sampleRate: number,
  threshold = 400,
  minKeepMs = 120
): { start: number; end: number } => {
  if (pcm.length === 0) return { start: 0, end: 0 };

  let first = -1;
  let last = -1;
  for (let i = 0; i < pcm.length; i++) {
    const sample = pcm[i] ?? 0;
    if (sample > threshold || sample < -threshold) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1) return { start: 0, end: 0 };

  const minKeepSamples = Math.floor((sampleRate * minKeepMs) / 1000);
  const paddedFirst = Math.max(0, first - minKeepSamples);
  const paddedLast = Math.min(pcm.length - 1, last + minKeepSamples);
  return { start: paddedFirst, end: paddedLast };
};

export const slicePcm = (
  pcm: Int16Array,
  start: number,
  end: number
): Int16Array => pcm.subarray(start, end + 1);
