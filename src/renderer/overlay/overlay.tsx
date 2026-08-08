import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@iconify/react";
import type { OverlayWindowApi } from "../../shared/api";
import type { CaptureState } from "../../shared/capture";
import { INITIAL_CAPTURE_STATE } from "../../shared/capture";
import type { MeetingLevelsEvent } from "../../shared/ipc";
import type { MeetingErrorCode, MeetingState } from "../../shared/meeting";
import { INITIAL_MEETING_STATE } from "../../shared/meeting";
import { t, type MessageKey } from "../../shared/i18n";
import { meetingMeterScale } from "../main/lib/meeting-meter";
import { Waveform } from "./Waveform";
import { useDragPanel } from "./useDragPanel";
import { RecordingBall } from "../shared/RecordingBall";
import { BlocksWave } from "../shared/BlocksWave";

const BAR_COUNT = 32;
const SILENT_BANDS: readonly number[] = Array.from({ length: BAR_COUNT }, () => 0);
const SILENT_MEETING_LEVELS: MeetingLevelsEvent = { system: 0, microphone: 0 };

const MEETING_ERROR_KEYS: Record<MeetingErrorCode, MessageKey> = {
  "assets-missing": "meetings.error.assets-missing",
  "engine-not-ready": "meetings.error.engine-not-ready",
  "worker-start-failed": "meetings.error.worker-start-failed",
  "worker-failed": "meetings.error.worker-failed",
  "window-load-failed": "meetings.error.window-load-failed",
  "loopback-denied": "meetings.error.loopback-denied",
  "loopback-unavailable": "meetings.error.loopback-unavailable",
  "database-unavailable": "meetings.error.database-unavailable",
  "already-running": "meetings.error.already-running"
};

const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${String(seconds)}s`;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
};

function StateDot({ state }: { readonly state: "arming" | "listening" | "transcribing" | "error" }): JSX.Element {
  const color =
    state === "listening"
      ? "var(--sv-capture)"
      : state === "transcribing"
        ? "var(--sv-info)"
        : state === "error"
          ? "var(--sv-danger)"
          : "var(--sv-accent)";
  return (
    <span className="h-2 w-2 shrink-0 rounded-pill" style={{ backgroundColor: color }} aria-hidden="true" />
  );
}

/**
 * The capture panel. Plain words, no jargon. The pill morphs between
 * five states: arming, listening, transcribing, delivering, error.
 */
export function Overlay(): JSX.Element | null {
  const api = window.struqVoice as OverlayWindowApi;
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [bands, setBands] = useState<readonly number[] | null>(null);
  const [partial, setPartial] = useState("");
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [meeting, setMeeting] = useState<MeetingState>(INITIAL_MEETING_STATE);
  const [meetingLevels, setMeetingLevels] = useState<MeetingLevelsEvent>(SILENT_MEETING_LEVELS);
  const sequenceRef = useRef(0);

  const drag = useDragPanel(api.move);

  useEffect(() => {
    const unsubscribeState = api.onCaptureStateChanged((next, live) => {
      setState(next);
      setLiveEnabled(live);
    });
    const unsubscribeLevels = api.onCaptureLevelsChanged((data) => {
      setBands(data.bands);
    });
    const unsubscribePartial = api.onPartialTranscript((data) => {
      if (data.sequence < sequenceRef.current) return;
      sequenceRef.current = data.sequence;
      setPartial(data.text);
    });
    const unsubscribeMeeting = api.onMeetingStateChanged(setMeeting);
    const unsubscribeMeetingLevels = api.onMeetingLevels(setMeetingLevels);
    return () => {
      unsubscribeState();
      unsubscribeLevels();
      unsubscribePartial();
      unsubscribeMeeting();
      unsubscribeMeetingLevels();
    };
  }, [api]);

  // A new capture starts from a clean slate.
  useEffect(() => {
    if (state.phase === "arming" || state.phase === "idle") {
      sequenceRef.current = 0;
      setPartial("");
    }
    if (state.phase === "idle") {
      setBands(null);
    }
  }, [state.phase]);

  useEffect(() => {
    if (meeting.phase === "idle" || meeting.phase === "starting") {
      setMeetingLevels(SILENT_MEETING_LEVELS);
    }
  }, [meeting.phase]);

  const captureVisible = state.phase !== "idle";
  const meetingVisible = !captureVisible && meeting.phase !== "idle";
  const locale = api.initialLocale;

  return (
    <AnimatePresence>
      {(captureVisible || meetingVisible) && (
        <motion.div
          key="overlay-panel"
          initial={{ opacity: 0, scaleX: 0.18, scaleY: 0.88 }}
          animate={{ opacity: 1, scaleX: 1, scaleY: 1 }}
          exit={{ opacity: 0, scaleX: 0.18, scaleY: 0.88 }}
          style={{ transformOrigin: "center center" }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onPointerDown={drag.onPointerDown}
          className="flex h-full w-full cursor-grab flex-col gap-2 overflow-hidden rounded-lg border border-border bg-surface px-3 py-2 shadow-float active:cursor-grabbing"
        >
          {meetingVisible ? (
            <MeetingView state={meeting} levels={meetingLevels} locale={locale} />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {state.phase === "arming" && (
                <motion.div
                  key="arming"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex min-h-0 flex-1 items-center gap-2.5"
                >
                  <StateDot state="arming" />
                  <div className="h-5 min-w-0 flex-1">
                    <Waveform bands={SILENT_BANDS} idle />
                  </div>
                  <span className="shrink-0 text-2xs text-text-muted">
                    {t(locale, "overlay.starting")}
                  </span>
                </motion.div>
              )}

              {state.phase === "listening" && (
                <ListeningView
                  key="listening"
                  state={state}
                  bands={bands}
                  partial={partial}
                  liveEnabled={liveEnabled}
                  locale={locale}
                />
              )}

              {state.phase === "transcribing" && (
                <TranscribingView
                  key="transcribing"
                  partial={partial}
                  liveEnabled={liveEnabled}
                  locale={locale}
                />
              )}

              {state.phase === "delivering" && <DeliveringView key="delivering" />}

              {state.phase === "error" && (
                <ErrorView key="error" state={state} locale={locale} />
              )}
            </AnimatePresence>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ListeningView({
  state,
  bands,
  partial,
  liveEnabled,
  locale
}: {
  readonly state: Extract<CaptureState, { phase: "listening" }>;
  readonly bands: readonly number[] | null;
  readonly partial: string;
  readonly liveEnabled: boolean;
  readonly locale: string;
}): JSX.Element {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(Date.now() - state.startedAtMs);
    const clock = window.setInterval(() => {
      setElapsedMs(Date.now() - state.startedAtMs);
    }, 100);
    return () => {
      window.clearInterval(clock);
    };
  }, [state.startedAtMs]);

  const live = bands !== null;

  return (
    <>
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <RecordingBall className="h-4 w-4 shrink-0 text-capture" />
        <div className="h-5 min-w-0 flex-1">
          <Waveform bands={bands ?? SILENT_BANDS} idle={!live} />
        </div>
        <span className="shrink-0 text-2xs text-text-muted tabular-nums" data-numeric>
          {formatElapsed(elapsedMs)}
        </span>
      </div>
      {liveEnabled && (
        <div className="transcript-scroll min-h-0 flex-1 overflow-y-auto rounded-sm bg-bg-sunken px-2.5 py-1.5">
          {partial.length > 0 ? (
            <p className="text-2xs leading-relaxed text-text">{partial}</p>
          ) : (
            <p className="text-2xs text-text-muted">{t(locale, "overlay.listening")}</p>
          )}
        </div>
      )}
    </>
  );
}

function TranscribingView({
  partial,
  liveEnabled,
  locale
}: {
  readonly partial: string;
  readonly liveEnabled: boolean;
  readonly locale: string;
}): JSX.Element {
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2.5 px-0.5">
        <BlocksWave className="h-5 w-5 shrink-0 text-capture" />
      </div>
      {liveEnabled && (
        <div className="transcript-scroll min-h-0 flex-1 overflow-y-auto rounded-sm bg-bg-sunken px-2.5 py-1.5">
          {partial.length > 0 ? (
            <p className="text-2xs leading-relaxed text-text">{partial}</p>
          ) : (
            <p className="text-2xs text-text-muted">{t(locale, "overlay.working")}</p>
          )}
        </div>
      )}
    </>
  );
}

function DeliveringView(): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-h-0 flex-1 items-center justify-center"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 text-capture"
        aria-hidden="true"
      >
        <path
          d="M4 12.5l5 5L20 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="checkmark-draw"
        />
      </svg>
    </motion.div>
  );
}

function ErrorView({
  state,
  locale
}: {
  readonly state: Extract<CaptureState, { phase: "error" }>;
  readonly locale: string;
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center gap-2.5">
      <StateDot state="error" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-danger">{state.message}</p>
        {state.text !== null && state.text.length > 0 && (
          <p className="truncate text-2xs text-text-muted">{t(locale, "overlay.errorCopied")}</p>
        )}
      </div>
      <Icon icon="ph:warning-circle" className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
    </div>
  );
}

function MeetingView({
  state,
  levels,
  locale
}: {
  readonly state: MeetingState;
  readonly levels: MeetingLevelsEvent;
  readonly locale: string;
}): JSX.Element | null {
  if (state.phase === "idle") return null;

  if (state.phase === "starting") {
    return (
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <StateDot state="arming" />
        <span className="text-xs text-text">{t(locale, "overlay.meetingStarting")}</span>
      </div>
    );
  }

  if (state.phase === "recording") {
    return <MeetingRecordingView state={state} levels={levels} locale={locale} />;
  }

  if (state.phase === "paused") {
    return (
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <span className="h-2 w-2 shrink-0 rounded-pill bg-warning" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-xs text-text">{t(locale, "overlay.meetingPaused")}</span>
        <span className="shrink-0 text-2xs tabular-nums text-text-muted" data-numeric>
          {formatElapsed(state.pausedAtMs - state.startedAtMs)}
        </span>
      </div>
    );
  }

  if (state.phase === "finalizing") {
    return (
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <BlocksWave className="h-5 w-5 shrink-0 text-capture" />
        <span className="text-xs text-text">{t(locale, "overlay.meetingSaving")}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center gap-2.5">
      <StateDot state="error" />
      <p className="line-clamp-3 min-w-0 flex-1 text-2xs leading-relaxed text-danger">
        {t(locale, MEETING_ERROR_KEYS[state.code])}
      </p>
      <Icon icon="ph:warning-circle" className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
    </div>
  );
}

function MeetingRecordingView({
  state,
  levels,
  locale
}: {
  readonly state: Extract<MeetingState, { phase: "recording" }>;
  readonly levels: MeetingLevelsEvent;
  readonly locale: string;
}): JSX.Element {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - state.startedAtMs);

  useEffect(() => {
    setElapsedMs(Date.now() - state.startedAtMs);
    const clock = window.setInterval(() => {
      setElapsedMs(Date.now() - state.startedAtMs);
    }, 250);
    return () => {
      window.clearInterval(clock);
    };
  }, [state.startedAtMs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <RecordingBall className="h-4 w-4 shrink-0 text-capture" />
        <span className="min-w-0 flex-1 text-xs font-medium text-text">
          {t(locale, "overlay.meetingRecording")}
        </span>
        <span className="shrink-0 text-2xs tabular-nums text-text-muted" data-numeric>
          {formatElapsed(elapsedMs)}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
        <MeetingLane
          label={t(locale, "meetings.live.systemAudio")}
          level={levels.system}
          live={state.system.live}
          tone="accent"
        />
        <MeetingLane
          label={t(locale, "meetings.live.microphone")}
          level={levels.microphone}
          live={state.microphone.live}
          tone="ember"
        />
      </div>
    </div>
  );
}

function MeetingLane({
  label,
  level,
  live,
  tone
}: {
  readonly label: string;
  readonly level: number;
  readonly live: boolean;
  readonly tone: "accent" | "ember";
}): JSX.Element {
  const color = tone === "accent" ? "bg-accent" : "bg-ember";
  return (
    <div className="flex items-center gap-2">
      <span className={`w-20 shrink-0 truncate text-2xs ${live ? "text-text-secondary" : "text-warning"}`}>
        {label}
      </span>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-hover">
        <div
          className={`h-full w-full origin-left rounded-pill transition-transform duration-75 rtl:origin-right ${color}`}
          style={{ transform: `scaleX(${String(live ? meetingMeterScale(level) : 0)})` }}
        />
      </div>
    </div>
  );
}
