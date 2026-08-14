/**
 * Replays a WAV through the real meeting speaker pipeline (Silero VAD, the
 * production VAD lane, the CAM++ embedding extractor and the production
 * clusterer) and measures the result against a ground-truth label file.
 *
 * This exists because "the meeting found six speakers" is not a debuggable
 * report. The bench turns it into numbers: how many clusters came out, which
 * true speaker each one covers, and, most usefully, where the same-speaker and
 * different-speaker cosine distributions actually sit. The threshold is only
 * defensible if it is chosen from that separation rather than picked.
 *
 * It imports the production modules directly (Node strips the TypeScript), so
 * it measures the shipping code and not a reimplementation of it.
 *
 * Usage:
 *   node scripts/diarization-bench.mjs --wav fixtures/diarization/two-speaker.wav
 *   node scripts/diarization-bench.mjs --wav rec.wav --truth rec.truth.json --json
 *
 * Exits non-zero when a truth file is supplied and the cluster count is wrong,
 * so it can gate a change rather than merely describe one.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSpeakerClusterer, cosineSimilarity } from "../src/main/meeting/worker/speaker-clusterer.ts";
import { createVadLane } from "../src/main/meeting/worker/vad-lane.ts";
import { drainVadSegments } from "../src/main/meeting/worker/vad-segments.ts";
import { trimSilence, slicePcm } from "../src/main/audio/wav.ts";

const nodeRequire = createRequire(import.meta.url);

const SAMPLE_RATE = 16_000;
const WINDOW_SIZE = 512;
const ASSETS_ROOT = resolve("resources/meeting-assets");

/**
 * Mirrors the meeting block of src/shared/settings.ts. Duplicated rather than
 * imported because settings.ts reaches for zod and extensionless sibling
 * imports that Node's type stripping will not resolve; every value here is
 * overridable by a flag, which is the point of the bench.
 */
const DEFAULTS = {
  speakerThreshold: 0.55,
  speakerCreateThreshold: null,
  speakerMergeThreshold: 0.55,
  minSpeakerAudioMs: 3000,
  maxSpeakers: 0,
  vadMinSpeechMs: 250,
  vadMinSilenceMs: 500,
  vadMaxSpeechMs: 20_000
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {
    wav: resolve("fixtures/diarization/two-speaker.wav"),
    truth: null,
    json: null,
    trimBeforeEmbed: true,
    threshold: DEFAULTS.speakerThreshold,
    createThreshold: DEFAULTS.speakerCreateThreshold,
    mergeThreshold: DEFAULTS.speakerMergeThreshold,
    minSpeakerAudioMs: DEFAULTS.minSpeakerAudioMs,
    maxSpeakers: DEFAULTS.maxSpeakers,
    verbose: false
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => args[++i];
    if (arg === "--wav") out.wav = resolve(next());
    else if (arg === "--truth") out.truth = resolve(next());
    else if (arg === "--json") out.json = resolve(next() ?? "bench.json");
    else if (arg === "--no-trim") out.trimBeforeEmbed = false;
    else if (arg === "--threshold") out.threshold = Number(next());
    else if (arg === "--create-threshold") out.createThreshold = Number(next());
    else if (arg === "--merge-threshold") out.mergeThreshold = Number(next());
    else if (arg === "--min-speaker-audio-ms") out.minSpeakerAudioMs = Number(next());
    else if (arg === "--max-speakers") out.maxSpeakers = Number(next());
    else if (arg === "--verbose") out.verbose = true;
  }
  if (out.truth === null) {
    const guess = out.wav.replace(/\.wav$/i, ".truth.json");
    if (existsSync(guess)) out.truth = guess;
  }
  return out;
};

const readWavPcm = (path) => {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 4) !== "RIFF") throw new Error(`Not a RIFF file: ${path}`);
  let offset = 12;
  let rate = SAMPLE_RATE;
  let channels = 1;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(offset + 10);
      rate = buffer.readUInt32LE(offset + 12);
    }
    if (id === "data") {
      const start = offset + 8;
      const end = Math.min(start + size, buffer.length);
      const count = (end - start) >> 1;
      const all = new Int16Array(count);
      for (let i = 0; i < count; i++) all[i] = buffer.readInt16LE(start + i * 2);
      if (channels === 1) return { pcm: all, rate };
      // Downmix, so a stereo capture can be benched without a conversion step.
      const mono = new Int16Array(Math.floor(count / channels));
      for (let i = 0; i < mono.length; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += all[i * channels + c];
        mono[i] = Math.round(sum / channels);
      }
      return { pcm: mono, rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`No data chunk in ${path}`);
};

const percentile = (values, p) => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[index];
};

const fixed = (value, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : "n/a");

/** The truth speaker whose labelled span overlaps this utterance the most. */
const truthSpeakerFor = (truth, startMs, endMs) => {
  if (truth === null) return null;
  let best = null;
  let bestOverlap = 0;
  for (const utterance of truth.utterances) {
    const overlap = Math.min(endMs, utterance.endMs) - Math.max(startMs, utterance.startMs);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = utterance.speaker;
    }
  }
  return best;
};

const main = () => {
  const options = parseArgs();
  if (!existsSync(options.wav)) {
    process.stderr.write(
      `No fixture at ${options.wav}\nRun: node scripts/make-two-speaker-fixture.mjs\n`
    );
    process.exit(2);
  }

  const vadModel = join(ASSETS_ROOT, "meeting-vad-silero", "silero_vad.onnx");
  const embeddingModel = join(
    ASSETS_ROOT,
    "meeting-embedding-campplus-en",
    "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"
  );
  for (const path of [vadModel, embeddingModel]) {
    if (!existsSync(path)) {
      process.stderr.write(`Missing meeting asset: ${path}\n`);
      process.exit(2);
    }
  }

  const sherpa = nodeRequire("sherpa-onnx-node");
  const truth = options.truth === null ? null : JSON.parse(readFileSync(options.truth, "utf8"));
  const { pcm, rate } = readWavPcm(options.wav);
  if (rate !== SAMPLE_RATE) {
    process.stderr.write(`Expected ${String(SAMPLE_RATE)} Hz, got ${String(rate)} Hz.\n`);
    process.exit(2);
  }

  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: vadModel,
        threshold: 0.5,
        minSilenceDuration: DEFAULTS.vadMinSilenceMs / 1000,
        minSpeechDuration: DEFAULTS.vadMinSpeechMs / 1000,
        maxSpeechDuration: DEFAULTS.vadMaxSpeechMs / 1000,
        windowSize: WINDOW_SIZE
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: "cpu",
      debug: false
    },
    30
  );

  const extractor = new sherpa.SpeakerEmbeddingExtractor({
    model: embeddingModel,
    numThreads: 1,
    debug: false,
    provider: "cpu"
  });

  const embed = (samples) => {
    const stream = extractor.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    stream.inputFinished();
    return extractor.compute(stream, false);
  };

  // Collect every utterance first, so the similarity statistics can be
  // computed over the whole meeting independently of the clustering decisions.
  const utterances = [];
  const lane = createVadLane({
    windowSize: WINDOW_SIZE,
    acceptWindow: (window) => {
      vad.acceptWaveform(window);
    },
    drainSegments: () => drainVadSegments(vad),
    onUtterance: (utterance) => {
      utterances.push(utterance);
    }
  });

  process.stdout.write(`Reading ${options.wav}\n`);
  const batch = SAMPLE_RATE;
  for (let offset = 0; offset < pcm.length; offset += batch) {
    lane.pushInt16(pcm.subarray(offset, Math.min(offset + batch, pcm.length)));
  }
  vad.flush();
  lane.flush();

  const toInt16 = (samples) => {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = Math.round((samples[i] ?? 0) * 32767);
    return out;
  };

  const rows = utterances.map((utterance) => {
    const startMs = Math.round((utterance.startSample / SAMPLE_RATE) * 1000);
    const endMs = Math.round(((utterance.startSample + utterance.samples.length) / SAMPLE_RATE) * 1000);
    let embedded = utterance.samples;
    if (options.trimBeforeEmbed) {
      const int16 = toInt16(utterance.samples);
      const bounds = trimSilence(int16, SAMPLE_RATE);
      const sliced = slicePcm(int16, bounds.start, bounds.end);
      embedded = Float32Array.from(sliced, (value) => value / 32768);
    }
    const speechMs = Math.round((embedded.length / SAMPLE_RATE) * 1000);
    return {
      startMs,
      endMs,
      durationMs: endMs - startMs,
      speechMs,
      embedding: embed(embedded),
      truth: truthSpeakerFor(truth, startMs, endMs)
    };
  });

  // The separation statistics: what the embedder actually reports for two
  // utterances by the same person versus two by different people. The
  // threshold has to sit between these or no setting of it can work.
  const same = [];
  const different = [];
  if (truth !== null) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const score = cosineSimilarity(rows[i].embedding, rows[j].embedding);
        if (rows[i].truth === null || rows[j].truth === null) continue;
        (rows[i].truth === rows[j].truth ? same : different).push(score);
      }
    }
  }

  const clusterer = createSpeakerClusterer({
    threshold: options.threshold,
    maxSpeakers: options.maxSpeakers,
    ...(options.createThreshold !== null ? { createThreshold: options.createThreshold } : {}),
    ...(options.mergeThreshold !== null ? { mergeThreshold: options.mergeThreshold } : {})
  });

  for (const row of rows) {
    const provisional = options.minSpeakerAudioMs > 0 && row.speechMs < options.minSpeakerAudioMs;
    // The clusterer gained a second argument as part of this fix. Stay
    // callable against the one-argument version so the bench can be pointed
    // at an older checkout to reproduce the regression.
    row.key =
      clusterer.assign.length > 1
        ? clusterer.assign(row.embedding, { provisional })
        : clusterer.assign(row.embedding);
  }

  const aliases = typeof clusterer.aliases === "function" ? clusterer.aliases() : new Map();
  const resolveKey = (key) => {
    let current = key;
    for (let i = 0; i < 16 && aliases.has(current); i++) current = aliases.get(current);
    return current;
  };
  for (const row of rows) row.finalKey = resolveKey(row.key);

  const finalKeys = [...new Set(rows.map((row) => row.finalKey))].sort();
  const truthSpeakers = truth === null ? [] : [...new Set(rows.map((r) => r.truth).filter(Boolean))].sort();

  process.stdout.write(
    `\nVAD utterances: ${String(rows.length)}   ` +
      `median ${String(Math.round(percentile(rows.map((r) => r.speechMs), 50)))}ms   ` +
      `under 1s: ${String(rows.filter((r) => r.speechMs < 1000).length)}\n`
  );
  process.stdout.write(
    `Settings: threshold=${fixed(options.threshold, 2)} ` +
      `create=${options.createThreshold === null ? "n/a" : fixed(options.createThreshold, 2)} ` +
      `merge=${options.mergeThreshold === null ? "n/a" : fixed(options.mergeThreshold, 2)} ` +
      `minSpeakerAudioMs=${String(options.minSpeakerAudioMs)} ` +
      `trimBeforeEmbed=${String(options.trimBeforeEmbed)}\n`
  );

  // Separation as a function of how much speech the embedder was given. This
  // is the diagnostic that matters: an embedder handed 600ms of audio returns
  // something close to noise, and no threshold can rescue it. The floor below
  // which same and different stop separating is where minSpeakerAudioMs goes.
  if (truth !== null) {
    process.stdout.write(
      `\nSeparation by minimum utterance length (pairs where both sides are at least N)\n` +
        `   N     pairs   same-p50   diff-p50   gap   same-p10   diff-p90   overlap\n`
    );
    for (const floorMs of [0, 500, 1000, 1500, 2000, 3000]) {
      const s = [];
      const d = [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          if (rows[i].truth === null || rows[j].truth === null) continue;
          if (rows[i].speechMs < floorMs || rows[j].speechMs < floorMs) continue;
          const score = cosineSimilarity(rows[i].embedding, rows[j].embedding);
          (rows[i].truth === rows[j].truth ? s : d).push(score);
        }
      }
      if (s.length === 0 || d.length === 0) continue;
      const gap = percentile(s, 50) - percentile(d, 50);
      const overlap = percentile(d, 90) - percentile(s, 10);
      process.stdout.write(
        `  ${String(floorMs).padStart(4)}  ${String(s.length + d.length).padStart(6)}   ` +
          `${fixed(percentile(s, 50)).padStart(8)}   ${fixed(percentile(d, 50)).padStart(8)}   ` +
          `${fixed(gap).padStart(5)}   ${fixed(percentile(s, 10)).padStart(8)}   ` +
          `${fixed(percentile(d, 90)).padStart(8)}   ${fixed(overlap).padStart(7)}\n`
      );
    }
  }

  if (same.length > 0) {
    process.stdout.write(
      `\nCosine separation (ground truth)\n` +
        `  same speaker      n=${String(same.length).padStart(4)}  ` +
        `p10 ${fixed(percentile(same, 10))}  p50 ${fixed(percentile(same, 50))}  p90 ${fixed(percentile(same, 90))}  min ${fixed(percentile(same, 0))}\n` +
        `  different speaker n=${String(different.length).padStart(4)}  ` +
        `p10 ${fixed(percentile(different, 10))}  p50 ${fixed(percentile(different, 50))}  p90 ${fixed(percentile(different, 90))}  max ${fixed(percentile(different, 100))}\n` +
        `  suggested threshold (midpoint of same-p10 and different-p90): ` +
        `${fixed((percentile(same, 10) + percentile(different, 90)) / 2, 2)}\n`
    );
  }

  if (options.verbose) {
    process.stdout.write("\n  #    start      dur   speech   truth  raw   final\n");
    for (const [index, row] of rows.entries()) {
      process.stdout.write(
        `  ${String(index).padStart(3)}  ${String(row.startMs).padStart(7)}ms ` +
          `${String(row.durationMs).padStart(6)}ms ${String(row.speechMs).padStart(6)}ms   ` +
          `${String(row.truth ?? "-").padEnd(5)}  ${String(row.key).padEnd(4)} ${String(row.finalKey)}\n`
      );
    }
  }

  // Rebuilt from the final assignment rather than read out of the clusterer,
  // so it stays a check on the clustering rather than a restatement of it. If
  // two surviving clusters look like the same voice here, the merge stage is
  // the thing that failed.
  if (finalKeys.length > 1) {
    // Only the members long enough to have shaped a centroid. Averaging the
    // provisional ones back in would rebuild something the clusterer never
    // held, since those are exactly the embeddings it refuses to absorb.
    const identifying = (row) => row.speechMs >= options.minSpeakerAudioMs;
    const centroidOf = (key) => {
      const members = rows.filter((row) => row.finalKey === key && identifying(row));
      const first = members[0];
      if (first === undefined) return null;
      const sum = new Float32Array(first.embedding.length);
      for (const member of members) {
        for (let i = 0; i < sum.length; i++) sum[i] += member.embedding[i] / members.length;
      }
      return sum;
    };
    const built = finalKeys.map((key) => ({ key, vector: centroidOf(key), size: rows.filter((r) => r.finalKey === key).length }));
    process.stdout.write(`\nCluster centroid similarity (rebuilt from the final assignment)\n        ${finalKeys.map((k) => k.padStart(7)).join("")}\n`);
    for (const left of built) {
      const cells = built.map((right) =>
        left.vector === null || right.vector === null
          ? "    n/a"
          : fixed(cosineSimilarity(left.vector, right.vector)).padStart(7)
      );
      process.stdout.write(`  ${left.key.padEnd(4)}n=${String(left.size).padStart(2)}${cells.join("")}\n`);
    }
  }

  let ok = true;
  if (truth !== null) {
    process.stdout.write(`\nConfusion (truth rows, cluster columns)\n       ${finalKeys.map((k) => k.padStart(5)).join("")}\n`);
    let correct = 0;
    for (const speaker of truthSpeakers) {
      const counts = finalKeys.map(
        (key) => rows.filter((row) => row.truth === speaker && row.finalKey === key).length
      );
      correct += Math.max(...counts, 0);
      process.stdout.write(`  ${speaker.padEnd(5)}${counts.map((c) => String(c).padStart(5)).join("")}\n`);
    }
    const labelled = rows.filter((row) => row.truth !== null).length;
    // Purity: of the utterances in a cluster, the share belonging to that
    // cluster's dominant true speaker.
    let pure = 0;
    for (const key of finalKeys) {
      const inCluster = rows.filter((row) => row.finalKey === key && row.truth !== null);
      if (inCluster.length === 0) continue;
      const counts = truthSpeakers.map((s) => inCluster.filter((r) => r.truth === s).length);
      pure += Math.max(...counts, 0);
    }

    process.stdout.write(
      `\nSpeakers: expected ${String(truthSpeakers.length)}, found ${String(finalKeys.length)}` +
        `${aliases.size > 0 ? ` (after ${String(aliases.size)} merge${aliases.size === 1 ? "" : "s"})` : ""}\n` +
        `Coverage (dominant cluster per speaker): ${fixed((correct / labelled) * 100, 1)}%\n` +
        `Purity   (dominant speaker per cluster): ${fixed((pure / labelled) * 100, 1)}%\n`
    );
    ok = finalKeys.length === truthSpeakers.length;
    process.stdout.write(ok ? "\nPASS: speaker count matches ground truth.\n" : "\nFAIL: speaker count does not match ground truth.\n");
  } else {
    process.stdout.write(`\nSpeakers found: ${String(finalKeys.length)} (no truth file, nothing to check against)\n`);
  }

  if (options.json !== null) {
    writeFileSync(
      options.json,
      `${JSON.stringify(
        {
          wav: options.wav,
          options: { ...options, json: undefined },
          utterances: rows.map((row) => ({
            startMs: row.startMs,
            endMs: row.endMs,
            durationMs: row.durationMs,
            speechMs: row.speechMs,
            truth: row.truth,
            key: row.key,
            finalKey: row.finalKey
          })),
          speakers: finalKeys,
          expected: truthSpeakers.length,
          same: { p10: percentile(same, 10), p50: percentile(same, 50), p90: percentile(same, 90) },
          different: { p10: percentile(different, 10), p50: percentile(different, 50), p90: percentile(different, 90) }
        },
        null,
        2
      )}\n`
    );
    process.stdout.write(`Wrote ${options.json}\n`);
  }

  process.exit(ok ? 0 : 1);
};

main();
