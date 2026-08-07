/**
 * Meeting export: pure functions over MeetingRecord, segments and speakers.
 * No filesystem, no Electron: the IPC handler does the dialog and the write,
 * the same split the dictionary export uses. Speaker labels resolve from the
 * speakers map, falling back to the English default; gap rows render as
 * "[not transcribed]" in text and markdown and are skipped in SRT.
 */

import type { MeetingExportFormat } from "../../shared/ipc";
import type { MeetingRecord, MeetingSegment, MeetingSpeaker } from "../../shared/meeting";
import { defaultSpeakerLabel } from "../../shared/meeting";

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** HH:MM:SS,mmm for SRT cues. The one-hour boundary is where this breaks. */
const formatSrtTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
};

/** MM:SS for the inline timestamps in markdown and text. */
const formatStamp = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad(minutes)}:${pad(seconds)}`;
};

const formatDate = (epochMs: number): string =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(epochMs);

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
    : `${pad(minutes)}m ${pad(seconds)}s`;
};

const labelFor = (key: string, speakers: readonly MeetingSpeaker[]): string => {
  const assigned = speakers.find((speaker) => speaker.speakerKey === key);
  return assigned?.label ?? defaultSpeakerLabel(key);
};

export interface ExportInput {
  readonly meeting: MeetingRecord;
  readonly segments: readonly MeetingSegment[];
  readonly speakers: readonly MeetingSpeaker[];
  readonly format: MeetingExportFormat;
}

export const exportMeeting = (input: ExportInput): string => {
  switch (input.format) {
    case "markdown":
      return toMarkdown(input.meeting, input.segments, input.speakers);
    case "text":
      return toText(input.meeting, input.segments, input.speakers);
    case "srt":
      return toSrt(input.meeting, input.segments, input.speakers);
  }
};

export const toMarkdown = (
  meeting: MeetingRecord,
  segments: readonly MeetingSegment[],
  speakers: readonly MeetingSpeaker[]
): string => {
  const lines: string[] = [
    `# ${meeting.title}`,
    "",
    `*${formatDate(meeting.startedAtMs)} · ${formatDuration(meeting.durationMs)} · ${String(
      Math.max(1, meeting.speakerCount)
    )} speaker${meeting.speakerCount === 1 ? "" : "s"}*`,
    ""
  ];
  let lastKey: string | null = null;
  for (const segment of segments) {
    if (segment.gap) {
      lines.push(`_[not transcribed]_`);
      lines.push("");
      lastKey = null;
      continue;
    }
    const key = segment.speakerKey;
    if (key !== lastKey) {
      lines.push(`**${labelFor(key, speakers)}** _(${formatStamp(segment.startMs)})_`);
    }
    lines.push(segment.text);
    lines.push("");
    lastKey = key;
  }
  return `${lines.join("\n").trimEnd()}\n`;
};

export const toText = (
  meeting: MeetingRecord,
  segments: readonly MeetingSegment[],
  speakers: readonly MeetingSpeaker[]
): string => {
  const lines: string[] = [];
  for (const segment of segments) {
    if (segment.gap) {
      lines.push(`[${formatStamp(segment.startMs)}] [not transcribed]`);
      continue;
    }
    lines.push(
      `[${formatStamp(segment.startMs)}] ${labelFor(segment.speakerKey, speakers)}: ${segment.text}`
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
};

export const toSrt = (
  meeting: MeetingRecord,
  segments: readonly MeetingSegment[],
  speakers: readonly MeetingSpeaker[]
): string => {
  const cues: string[] = [];
  let index = 1;
  for (const segment of segments) {
    if (segment.gap) continue;
    cues.push(
      `${String(index)}\n${formatSrtTime(segment.startMs)} --> ${formatSrtTime(
        segment.endMs
      )}\n${labelFor(segment.speakerKey, speakers)}: ${segment.text}`
    );
    index += 1;
  }
  return `${cues.join("\n\n")}\n`;
};
