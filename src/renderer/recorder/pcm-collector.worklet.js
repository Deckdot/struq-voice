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
const CAPTURE_TAIL_MS = 300;
const CAPTURE_TAIL_SAMPLES = Math.ceil((SAMPLE_RATE * CAPTURE_TAIL_MS) / 1000);
const DEFAULT_MAX_CAPTURE_MS = 300000;
const ring = new Float32Array(SAMPLE_RATE * RING_SECONDS);
let ringPos = 0;
let armed = false;
/**
 * The capture, in a preallocated typed array rather than a growing JS array.
 * This runs on the audio thread, and a plain array of five minutes of samples
 * is millions of boxed numbers that then have to be copied out one by one at
 * the end. That copy is what made releasing the key after a long dictation
 * feel unresponsive, and it risked glitching the very audio it was collecting.
 * Reused across captures, so arming does not allocate megabytes each time.
 */
let active = new Float32Array(0);
let activeLength = 0;
let tailSamplesRemaining = 0;
let maxActiveSamples = SAMPLE_RATE * (RING_SECONDS + DEFAULT_MAX_CAPTURE_MS / 1000);

class PcmCollectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message.type === "arm") {
        armed = true;
        activeLength = 0;
        tailSamplesRemaining = 0;
        const maxCaptureMs = Math.max(5000, Math.min(600000, message.maxCaptureMs));
        maxActiveSamples =
          Math.ceil((SAMPLE_RATE * maxCaptureMs) / 1000) + SAMPLE_RATE * RING_SECONDS;
        if (active.length < maxActiveSamples) {
          active = new Float32Array(maxActiveSamples);
        }
        const preroll = Math.max(0, Math.min(SAMPLE_RATE * RING_SECONDS, message.prerollSamples));
        if (preroll > 0) {
          const start = (ringPos - preroll + ring.length) % ring.length;
          for (let i = 0; i < preroll; i++) {
            active[activeLength] = ring[(start + i) % ring.length];
            activeLength++;
          }
        }
      } else if (message.type === "disarm") {
        if (armed) {
          tailSamplesRemaining = CAPTURE_TAIL_SAMPLES;
        }
      } else if (message.type === "discard") {
        // Abort the capture: release the buffer without sending anything.
        armed = false;
        activeLength = 0;
        tailSamplesRemaining = 0;
      } else if (message.type === "snapshot") {
        // A partial read for the live transcript: copy what has been captured
        // so far and leave the capture running. slice copies, so transferring
        // the copy cannot disturb the buffer the real capture will hand over
        // at disarm.
        const samples = active.slice(0, activeLength);
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
        if (activeLength < maxActiveSamples) {
          active[activeLength] = sample;
          activeLength++;
        }
        if (tailSamplesRemaining > 0) {
          tailSamplesRemaining--;
          if (tailSamplesRemaining === 0) {
            armed = false;
            const samples = active.slice(0, activeLength);
            activeLength = 0;
            this.port.postMessage({ type: "capture", samples }, [samples.buffer]);
          }
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-collector", PcmCollectorProcessor);
