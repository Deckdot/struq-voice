import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface WorkletMessage {
  readonly data: Record<string, unknown>;
}

class MockPort {
  onmessage: ((event: WorkletMessage) => void) | null = null;
  readonly postMessage = vi.fn();
}

class MockAudioWorkletProcessor {
  readonly port = new MockPort();
}

interface PcmCollectorProcessor extends MockAudioWorkletProcessor {
  process: (inputs: readonly (readonly Float32Array[])[]) => boolean;
}

type ProcessorConstructor = new () => PcmCollectorProcessor;

const loadProcessor = (): PcmCollectorProcessor => {
  const source = readFileSync(
    join(process.cwd(), "src", "renderer", "recorder", "pcm-collector.worklet.js"),
    "utf8"
  );
  const registration: { Processor?: ProcessorConstructor } = {};
  runInNewContext(source, {
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    Float32Array,
    Math,
    registerProcessor: (_name: string, constructor: ProcessorConstructor): void => {
      registration.Processor = constructor;
    }
  });
  const Processor = registration.Processor;
  if (Processor === undefined) throw new Error("worklet did not register its processor");
  return new Processor();
};

describe("PCM collector worklet", () => {
  it("keeps a 300ms audio tail after disarm before sealing the capture", () => {
    const processor = loadProcessor();
    processor.port.onmessage?.({
      data: { type: "arm", prerollSamples: 0, maxCaptureMs: 5000 }
    });
    processor.process([[new Float32Array(10).fill(0.25)]]);
    processor.port.onmessage?.({ data: { type: "disarm" } });

    processor.process([[new Float32Array(4799).fill(0.5)]]);
    expect(processor.port.postMessage).not.toHaveBeenCalled();

    processor.process([[new Float32Array([0.75])]]);
    expect(processor.port.postMessage).toHaveBeenCalledTimes(1);
    const payload = processor.port.postMessage.mock.calls[0]?.[0] as {
      readonly type: string;
      readonly samples: Float32Array;
    } | undefined;
    expect(payload?.type).toBe("capture");
    expect(payload?.samples).toHaveLength(4810);
    expect(payload?.samples.at(-1)).toBeCloseTo(0.75);
  });

  it("does not leak the previous capture into the next one", () => {
    // The sample buffer is preallocated and reused, so arming has to reset the
    // write position rather than rely on a fresh array.
    const processor = loadProcessor();
    const runCapture = (value: number, length: number): Float32Array | undefined => {
      processor.port.onmessage?.({
        data: { type: "arm", prerollSamples: 0, maxCaptureMs: 5000 }
      });
      processor.process([[new Float32Array(length).fill(value)]]);
      processor.port.onmessage?.({ data: { type: "disarm" } });
      processor.process([[new Float32Array(4800).fill(value)]]);
      const calls = processor.port.postMessage.mock.calls;
      return (calls.at(-1)?.[0] as { readonly samples: Float32Array } | undefined)?.samples;
    };

    const first = runCapture(0.25, 8000);
    expect(first).toHaveLength(12_800);

    const second = runCapture(0.5, 1000);
    expect(second).toHaveLength(5800);
    // Every sample belongs to the second capture, not to the longer first one.
    expect(second?.every((sample) => Math.abs(sample - 0.5) < 1e-6)).toBe(true);
  });

  it("discards a capture without emitting anything", () => {
    const processor = loadProcessor();
    processor.port.onmessage?.({
      data: { type: "arm", prerollSamples: 0, maxCaptureMs: 5000 }
    });
    processor.process([[new Float32Array(8000).fill(0.4)]]);
    processor.port.onmessage?.({ data: { type: "discard" } });
    processor.process([[new Float32Array(8000).fill(0.4)]]);

    expect(processor.port.postMessage).not.toHaveBeenCalled();
  });
});
