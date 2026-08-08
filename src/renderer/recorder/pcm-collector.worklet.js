/**
 * The pcm-collector AudioWorklet processor.
 *
 * Plain JS, no imports: worklets are loaded with addModule and must be
 * self-contained. It keeps a 30-second rolling ring buffer of the live
 * stream (pre-roll for captures) and, while armed, appends every sample to
 * the active capture buffer.
 */

const SAMPLE_RATE = 16000;
const RING_SECONDS = 30;
const DEFAULT_MAX_CAPTURE_MS = 300000;
const ring = new Float32Array(SAMPLE_RATE * RING_SECONDS);
let ringPos = 0;
let armed = false;
let active = [];
let maxActiveSamples = SAMPLE_RATE * (RING_SECONDS + DEFAULT_MAX_CAPTURE_MS / 1000);

class PcmCollectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message.type === "arm") {
        armed = true;
        active = [];
        const maxCaptureMs = Math.max(5000, Math.min(600000, message.maxCaptureMs));
        maxActiveSamples =
          Math.ceil((SAMPLE_RATE * maxCaptureMs) / 1000) + SAMPLE_RATE * RING_SECONDS;
        const preroll = Math.max(0, Math.min(SAMPLE_RATE * RING_SECONDS, message.prerollSamples));
        if (preroll > 0) {
          const start = (ringPos - preroll + ring.length) % ring.length;
          for (let i = 0; i < preroll; i++) {
            active.push(ring[(start + i) % ring.length]);
          }
        }
      } else if (message.type === "disarm") {
        armed = false;
        const samples = Float32Array.from(active);
        active = [];
        this.port.postMessage({ type: "capture", samples }, [samples.buffer]);
      } else if (message.type === "discard") {
        // Abort the capture: release the buffer without sending anything.
        armed = false;
        active = [];
      } else if (message.type === "snapshot") {
        // A partial read for the live transcript: copy what has been captured
        // so far and leave the capture running. Float32Array.from copies, so
        // transferring the copy cannot disturb the buffer the real capture
        // will hand over at disarm.
        const samples = Float32Array.from(active);
        this.port.postMessage(
          { type: "snapshot", samples, sequence: message.sequence },
          [samples.buffer]
        );
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (input === undefined || input.length === 0) return true;
    const channel = input[0];
    if (channel === undefined) return true;

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i] ?? 0;
      ring[ringPos] = sample;
      ringPos = (ringPos + 1) % ring.length;
      if (armed) {
        if (active.length < maxActiveSamples) {
          active.push(sample);
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-collector", PcmCollectorProcessor);
