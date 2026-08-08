import { describe, expect, it, vi } from "vitest";
import { connectMeetingLaneGraph } from "./audio-graph";

const makeNode = (): { readonly node: AudioNode; readonly connect: ReturnType<typeof vi.fn> } => {
  const connect = vi.fn();
  return { node: { connect } as unknown as AudioNode, connect };
};

describe("meeting audio graph", () => {
  it("keeps transcription rendering as the archive input", () => {
    const source = makeNode();
    const worklet = makeNode();
    const archiveSink = makeNode();

    connectMeetingLaneGraph(source.node, worklet.node, archiveSink.node);

    expect(source.connect).toHaveBeenCalledWith(worklet.node);
    expect(worklet.connect).toHaveBeenCalledWith(archiveSink.node);
  });
});
