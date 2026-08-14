/**
 * Renders a deterministic two-speaker conversation to a 16 kHz mono WAV with a
 * ground-truth label file, so speaker clustering can be measured instead of
 * guessed at.
 *
 * Windows SAPI is the source: it is offline, it ships with the OS, it writes
 * 16 kHz mono PCM directly, and two of its voices (David and Zira) are a male
 * and a female speaker. No audio is committed to the repo and no third party
 * corpus is downloaded.
 *
 * Clean TTS is far more separable than a real conference call, so a fixture
 * rendered flat would pass even against broken clustering. `--degrade` (on by
 * default) therefore models what a call does to a voice: a transmission path
 * drawn once per participant (their mic, their room, their codec), mild
 * per-utterance level jitter, and a noise floor. The randomness is seeded, so
 * two runs produce identical bytes.
 *
 * Two fixtures come out of this, and the single-speaker one is the important
 * one. The reported bug is that a call with one other person found six
 * speakers, so the sharpest test is a stream containing exactly one voice that
 * must cluster to exactly one label. The two-speaker fixture then checks that
 * the fix did not overcorrect into merging genuinely different people.
 *
 * Inter-line gaps stay above the VAD's minSilenceDuration on purpose. Below
 * it, the detector merges consecutive turns into a single utterance whose
 * embedding is a blend of two voices, which makes ground truth meaningless and
 * measures the VAD rather than the clustering.
 *
 * Usage:
 *   node scripts/make-two-speaker-fixture.mjs [--out DIR] [--speakers 1|2]
 *                                             [--no-degrade] [--seed N]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SAMPLE_RATE = 16_000;

const VOICES = {
  A: "Microsoft David Desktop",
  B: "Microsoft Zira Desktop"
};

/**
 * A two-person product call. Deliberately shaped to exercise the three cases
 * that break streaming diarization: turns long enough to enter the pyannote
 * refinement path, ordinary turns, and the short backchannels that produce
 * embeddings too brief to fingerprint.
 */
const SCRIPT = [
  { speaker: "A", gapMs: 920, text: "Right, thanks for making the time. I wanted to walk you through where we landed on the ingestion rewrite, because the numbers moved quite a lot since the last review and I think it changes what we should do in the next quarter. The short version is that batching the writes took the p99 from about four seconds down to just under six hundred milliseconds, which is better than the target we set." },
  { speaker: "B", gapMs: 820, text: "That is a big jump." },
  { speaker: "A", gapMs: 770, text: "It is, and honestly more than I expected." },
  { speaker: "B", gapMs: 870, text: "What was actually causing the four seconds? Was it the serialization or was it further down in the storage layer?" },
  { speaker: "A", gapMs: 820, text: "Mostly the storage layer. Every record was opening its own transaction, so we were paying the fsync cost per row instead of per batch. Once we grouped them into batches of five hundred the cost amortized almost completely, and the remaining time is dominated by the network round trip rather than anything we control." },
  { speaker: "B", gapMs: 800, text: "Mhm." },
  { speaker: "A", gapMs: 760, text: "Exactly." },
  { speaker: "B", gapMs: 840, text: "So what is the risk with batching? I assume we are now holding more in memory before anything is durable, which means a crash loses more." },
  { speaker: "A", gapMs: 820, text: "That is the trade, yes. Worst case we lose whatever is in the current batch, so up to five hundred records. We can bound it with a time based flush as well as a size based one, which is what I would suggest: flush at five hundred records or two hundred milliseconds, whichever comes first. That caps the loss window at something we can actually describe to a customer." },
  { speaker: "B", gapMs: 820, text: "Yeah, that seems reasonable." },
  { speaker: "A", gapMs: 780, text: "Good." },
  { speaker: "B", gapMs: 860, text: "I do want to think about the failure mode a bit more carefully though, because if the flush timer is the only thing standing between us and data loss then the timer becoming starved under load is suddenly a correctness problem rather than a latency problem. Have we tested what happens when the event loop is saturated?" },
  { speaker: "A", gapMs: 840, text: "Not properly. I ran it under synthetic load but not with the timer contending against real decode work, so I would call that an open question rather than something we have cleared." },
  { speaker: "B", gapMs: 800, text: "Right." },
  { speaker: "A", gapMs: 820, text: "I will add it to the test plan before we ship anything." },
  { speaker: "B", gapMs: 870, text: "The other thing I keep coming back to is observability. If we batch, then a single failure is now a batch failure, and the error we surface has to tell somebody which record actually broke rather than just saying the batch did not commit. Otherwise we are trading a latency problem for a debugging problem, and I have watched that trade go badly before." },
  { speaker: "A", gapMs: 820, text: "Agreed. The plan there is to keep per record identifiers in the batch envelope so a rejection can name the offending row. It costs a bit of memory but it is the difference between an actionable error and a useless one." },
  { speaker: "B", gapMs: 800, text: "Good." },
  { speaker: "A", gapMs: 780, text: "That was my thinking too." },
  { speaker: "B", gapMs: 850, text: "What about the migration path for existing deployments?" },
  { speaker: "A", gapMs: 820, text: "It is backward compatible. The batching lives entirely on the write side and the on disk format does not change, so an older reader can read anything a newer writer produces. That means we can roll it out progressively and roll it back without a data migration, which is the main reason I want to do this one first rather than the schema work." },
  { speaker: "B", gapMs: 800, text: "Okay, that makes sense." },
  { speaker: "A", gapMs: 760, text: "Mhm." },
  { speaker: "B", gapMs: 840, text: "Then I think the sequencing you are proposing is right. Do the batching now because it is reversible, get the load testing done properly so we understand the timer behaviour, and hold the schema change until we have a quarter of production data telling us the write path is actually stable." },
  { speaker: "A", gapMs: 820, text: "That is exactly where I landed." },
  { speaker: "B", gapMs: 800, text: "Great." },
  { speaker: "A", gapMs: 820, text: "I will write it up and send it round before Thursday." },
  { speaker: "B", gapMs: 780, text: "Perfect, thanks." }
];

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {
    outDir: resolve("fixtures/diarization"),
    degrade: true,
    seed: 20260811,
    speakers: 2
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--out") {
      const value = args[++i];
      if (value !== undefined) out.outDir = resolve(value);
    } else if (arg === "--no-degrade") {
      out.degrade = false;
    } else if (arg === "--seed") {
      const value = args[++i];
      if (value !== undefined) out.seed = Number(value);
    } else if (arg === "--speakers") {
      const value = args[++i];
      if (value !== undefined) out.speakers = Number(value);
    }
  }
  if (out.speakers !== 1 && out.speakers !== 2) {
    throw new Error("--speakers takes 1 or 2.");
  }
  return out;
};

/** mulberry32: a small seeded PRNG, so a fixture is reproducible byte for byte. */
const createRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;

/**
 * Renders every line in one PowerShell process. Spawning a synthesizer per
 * line costs about a second each; batching keeps the whole fixture under a
 * minute.
 */
const renderLines = (lines, workDir) => {
  const commands = [
    "Add-Type -AssemblyName System.Speech",
    "$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    // Rate is held flat on purpose. SAPI's steps are coarse enough that one
    // step either side rescales formant timing more than any real speaker
    // varies, which pushes the audio outside what the embedder was trained on
    // and collapsed same-speaker similarity from 0.81 to 0.68. Genuine
    // within-speaker variation is already present: every line is different
    // words, which is what moves an embedding in a real meeting.
    "$s.Rate = 0"
  ];

  for (const [index, line] of lines.entries()) {
    const path = join(workDir, `line-${String(index).padStart(3, "0")}.wav`);
    commands.push(
      `$s.SelectVoice(${psQuote(VOICES[line.speaker])})`,
      `$s.SetOutputToWaveFile(${psQuote(path)}, $fmt)`,
      `$s.Speak(${psQuote(line.text)})`
    );
  }
  commands.push("$s.SetOutputToNull()", "$s.Dispose()");

  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", commands.join("; ")],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
};

/** Reads the data chunk of a canonical 16-bit PCM WAV into an Int16Array. */
const readWavPcm = (path) => {
  const buffer = readFileSync(path);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "data") {
      const start = offset + 8;
      const end = Math.min(start + size, buffer.length);
      const count = (end - start) >> 1;
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i++) samples[i] = buffer.readInt16LE(start + i * 2);
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`No data chunk in ${path}`);
};

const writeWav = (path, samples) => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length * 2, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length * 2, 40);
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) body.writeInt16LE(samples[i], i * 2);
  writeFileSync(path, Buffer.concat([header, body]));
};

/**
 * A per-participant transmission path: their microphone, their room and their
 * codec. Drawn once per speaker and held for the whole call, because that is
 * how a real meeting behaves. Re-drawing it per utterance would model a
 * participant who swaps headsets between sentences, and it depresses
 * same-speaker similarity so far that no threshold can separate anyone.
 */
const createChannel = (random) => ({
  gain: 0.7 + random() * 0.25,
  // Opus at conferencing bitrates keeps most of a 16 kHz band. An earlier
  // draft rolled off around 3.5 kHz, which is a telephone line, not a call:
  // it strips what the embedder relies on and drives same-speaker similarity
  // down to where no threshold separates anybody.
  cutoffHz: 5200 + random() * 1600
});

/**
 * Approximates what a conferencing stack does to a voice before it reaches the
 * loopback device: a codec that discards the top of the band, imperfect level
 * control, and a permanent noise floor. Jitter around the speaker's own
 * channel stays small, standing in for prosody and distance from the mic
 * rather than for a different device.
 */
const degradeUtterance = (samples, random, channel) => {
  const gain = channel.gain * (0.94 + random() * 0.12);
  const cutoff = channel.cutoffHz * (0.96 + random() * 0.08);
  const out = new Float32Array(samples.length);
  let previous = 0;
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
  for (let i = 0; i < samples.length; i++) {
    previous += alpha * (samples[i] / 32768 - previous);
    out[i] = previous * gain;
  }
  return out;
};

const main = () => {
  const { outDir, degrade, seed, speakers } = parseArgs();
  const random = createRandom(seed);
  const workDir = join(tmpdir(), `struq-fixture-${String(process.pid)}`);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // One voice reading both sides of the script is the direct reproduction of
  // the reported bug: whatever comes out must be exactly one speaker.
  const lines =
    speakers === 1 ? SCRIPT.map((line) => ({ ...line, speaker: "A" })) : SCRIPT;

  process.stdout.write(
    `Rendering ${String(lines.length)} lines with SAPI (${String(speakers)} voice${speakers === 1 ? "" : "s"})...\n`
  );
  renderLines(lines, workDir);

  const chunks = [];
  const utterances = [];
  let cursor = 0;

  const pushSilence = (ms) => {
    const count = Math.round((ms / 1000) * SAMPLE_RATE);
    chunks.push(new Float32Array(count));
    cursor += count;
  };

  // Lead-in, so the VAD does not open on the very first sample.
  pushSilence(700);

  const channels = { A: createChannel(random), B: createChannel(random) };

  for (const [index, line] of lines.entries()) {
    const pcm = readWavPcm(join(workDir, `line-${String(index).padStart(3, "0")}.wav`));
    const rendered = degrade
      ? degradeUtterance(pcm, random, channels[line.speaker])
      : Float32Array.from(pcm, (value) => value / 32768);
    const startMs = Math.round((cursor / SAMPLE_RATE) * 1000);
    chunks.push(rendered);
    cursor += rendered.length;
    utterances.push({
      speaker: line.speaker,
      startMs,
      endMs: Math.round((cursor / SAMPLE_RATE) * 1000),
      durationMs: Math.round((rendered.length / SAMPLE_RATE) * 1000),
      text: line.text
    });
    pushSilence(line.gapMs);
  }
  pushSilence(700);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const mixed = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    mixed.set(chunk, offset);
    offset += chunk.length;
  }

  if (degrade) {
    // A noise floor across the whole timeline, not just under speech: silence
    // that is digitally perfect makes the VAD unrealistically confident.
    for (let i = 0; i < mixed.length; i++) {
      mixed[i] += (random() * 2 - 1) * 0.0025;
    }
  }

  let peak = 0;
  for (const value of mixed) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0 ? 0.89 / peak : 1;
  const pcm = new Int16Array(mixed.length);
  for (let i = 0; i < mixed.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(mixed[i] * scale * 32767)));
  }

  const stem = speakers === 1 ? "one-speaker" : "two-speaker";
  const wavPath = join(outDir, `${stem}.wav`);
  const truthPath = join(outDir, `${stem}.truth.json`);
  writeWav(wavPath, pcm);
  writeFileSync(
    truthPath,
    `${JSON.stringify(
      {
        sampleRate: SAMPLE_RATE,
        seed,
        degraded: degrade,
        voices: speakers === 1 ? { A: VOICES.A } : VOICES,
        speakers: speakers === 1 ? ["A"] : ["A", "B"],
        durationMs: Math.round((pcm.length / SAMPLE_RATE) * 1000),
        utterances
      },
      null,
      2
    )}\n`
  );
  rmSync(workDir, { recursive: true, force: true });

  const shortCount = utterances.filter((u) => u.durationMs < 1000).length;
  process.stdout.write(
    `Wrote ${wavPath}\n` +
      `Wrote ${truthPath}\n` +
      `${String(utterances.length)} utterances, ${String(shortCount)} under 1s, ` +
      `${(pcm.length / SAMPLE_RATE / 60).toFixed(1)} minutes, degraded=${String(degrade)}\n`
  );
};

main();
