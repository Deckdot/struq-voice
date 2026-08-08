/**
 * Connect one meeting lane through transcription into the shared archive.
 * MediaRecorder continuously pulls the archive sink, which guarantees the
 * AudioWorklet stays active in Chromium's hidden meeting window.
 */
export const connectMeetingLaneGraph = (
  source: AudioNode,
  worklet: AudioNode,
  archiveSink: AudioNode
): void => {
  source.connect(worklet);
  worklet.connect(archiveSink);
};
