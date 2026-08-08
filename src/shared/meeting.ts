/**
 * Meeting state, shared by every surface: tray, main window, tests. The
 * session in src/main/meeting/meeting-session.ts is the single authority;
 * everything else renders from broadcasts of this union.
 */

export type MeetingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "finalizing"
  | "error";

/** Which capture lane a segment came from. */
export type MeetingSource = "system" | "microphone";

/**
 * Stable identity for a voice within one meeting. "me" is the microphone
 * lane, which needs no clustering. "s1", "s2" and so on are clusters found
 * on the system lane, numbered in first-heard order.
 */
export type SpeakerKey = string;

export interface MeetingLaneHealth {
  readonly live: boolean;
  /** Machine-readable, translated in the renderer. Never a raw Error string. */
  readonly code?: MeetingLaneErrorCode;
}

export type MeetingLaneErrorCode =
  | "loopback-unavailable"
  | "loopback-denied"
  | "microphone-unavailable"
  | "device-changed";

export type MeetingState =
  | { readonly phase: "idle" }
  | { readonly phase: "starting" }
  | {
      readonly phase: "recording";
      readonly meetingId: number;
      readonly startedAtMs: number;
      readonly system: MeetingLaneHealth;
      readonly microphone: MeetingLaneHealth;
      /** Seconds of captured audio not yet transcribed. 0 when keeping up. */
      readonly backlogSeconds: number;
      readonly segmentCount: number;
      readonly speakerCount: number;
    }
  | {
      readonly phase: "paused";
      readonly meetingId: number;
      readonly startedAtMs: number;
      readonly pausedAtMs: number;
      readonly segmentCount: number;
    }
  | {
      readonly phase: "finalizing";
      readonly meetingId: number;
      /** Utterances still queued in the worker, so the UI can show progress. */
      readonly remaining: number;
    }
  | { readonly phase: "error"; readonly code: MeetingErrorCode };

export type MeetingErrorCode =
  | "assets-missing"
  | "engine-not-ready"
  | "worker-failed"
  | "loopback-unavailable"
  | "database-unavailable"
  | "already-running";

export const INITIAL_MEETING_STATE: MeetingState = { phase: "idle" };

export const isMeetingActive = (state: MeetingState): boolean =>
  state.phase === "recording" ||
  state.phase === "paused" ||
  state.phase === "starting" ||
  state.phase === "finalizing";

/** One line of transcript. The shape both processes share. */
export interface MeetingSegment {
  readonly id: number;
  readonly meetingId: number;
  /** Milliseconds from the start of the meeting. */
  readonly startMs: number;
  readonly endMs: number;
  readonly source: MeetingSource;
  readonly speakerKey: SpeakerKey;
  readonly text: string;
  /** True when this row marks audio that was captured but not transcribed. */
  readonly gap: boolean;
}

export interface MeetingRecord {
  readonly id: number;
  readonly title: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly durationMs: number;
  readonly engineId: string;
  readonly modelId: string;
  readonly language: string | null;
  /** Absolute path to recording.webm, or null when archiving was off. */
  readonly audioPath: string | null;
  readonly audioBytes: number;
  readonly speakerCount: number;
  readonly wordCount: number;
  readonly state: "recording" | "complete" | "interrupted";
}

/** Per-meeting speaker labels the user has assigned. */
export interface MeetingSpeaker {
  readonly speakerKey: SpeakerKey;
  readonly label: string;
}

/**
 * The default label for a key with no user-assigned name. English on
 * purpose: it is used by export files and main-side titling where there is
 * no t(). The renderer must translate meetings.speaker.you and
 * meetings.speaker.numbered instead of displaying this.
 */
export const defaultSpeakerLabel = (key: SpeakerKey): string =>
  key === "me" ? "You" : `Speaker ${key.replace(/^s/, "")}`;
