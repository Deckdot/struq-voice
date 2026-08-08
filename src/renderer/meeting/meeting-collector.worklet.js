/**
 * The meeting-collector AudioWorklet processor.
 *
 * One instance per lane. It converts to Int16 and posts a fixed batch every
 * BATCH_SAMPLES, carrying the index of the first sample so the two lanes share
 * one clock without a wall-clock timestamp.
 *
 * The batching lives here rather than on a renderer timer on purpose: this
 * runs on the real-time audio thread, which Chromium never throttles, while a
 * setInterval in a hidden window is throttled to once a second.
 */

const BATCH_SAMPLES = 16000; // 1 second at 16 kHz

class MeetingCollectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(BATCH_SAMPLES);
    this.filled = 0;
    this.totalSamples = 0;
    this.peak = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data.type === "flush") {
        this.flush(true);
        this.stopped = true;
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  flush(partial) {
    if (this.filled === 0) return;
    const length = partial ? this.filled : BATCH_SAMPLES;
    const out = this.buffer.slice(0, length);
    this.port.postMessage(
      {
        type: "batch",
        pcm: out.buffer,
        startSample: this.totalSamples - length,
        peak: this.peak
      },
      [out.buffer]
    );
    this.filled = 0;
    this.peak = 0;
  }

  process(inputs, outputs) {
    if (this.stopped) return true;
    const input = inputs[0];
    if (input === undefined || input.length === 0) return true;
    const channel = input[0];
    if (channel === undefined) return true;

    const output = outputs[0];
    if (output !== undefined) {
      for (const outputChannel of output) {
        outputChannel.set(channel);
      }
    }

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i] ?? 0;
      const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
      const magnitude = clamped < 0 ? -clamped : clamped;
      if (magnitude > this.peak) this.peak = magnitude;
      this.buffer[this.filled] = Math.round(clamped * 32767);
      this.filled += 1;
      this.totalSamples += 1;
      if (this.filled === BATCH_SAMPLES) {
        this.flush(false);
      }
    }
    return true;
  }
}

registerProcessor("meeting-collector", MeetingCollectorProcessor);
