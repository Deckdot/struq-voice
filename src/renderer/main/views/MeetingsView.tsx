import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { AnimatePresence, motion } from "motion/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MainWindowApi } from "../../../shared/api";
import type {
  MeetingAssetProgressEvent,
  MeetingAssetsResult,
  MeetingLevelsEvent
} from "../../../shared/ipc";
import type {
  MeetingErrorCode,
  MeetingRecord,
  MeetingSegment,
  MeetingSpeaker,
  MeetingState
} from "../../../shared/meeting";
import { isMeetingActive } from "../../../shared/meeting";
import { REQUIRED_ASSET_BYTES } from "../../../shared/meeting-assets";
import { formatAccelerator, DEFAULT_MEETING_ACCELERATOR } from "../../../shared/hotkeys";
import type { MessageKey } from "../../../shared/i18n";
import { useMainStore } from "../store/use-main-store";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Kbd,
  ProgressBar,
  SearchInput,
  StatusDot
} from "../components/ui";
import { useTranslation } from "../lib/useTranslation";
import { meetingMeterScale } from "../lib/meeting-meter";

const PAGE_SIZE = 50;
const ROW_HEIGHT = 44;
const LIVE_POLL_MS = 250;
// The live transcript view only renders recent context: the full transcript
// lives in main and history, and the finished meeting shows all of it. Cap the
// retained tail to keep hours-long meetings from growing this array without
// bound. At roughly one segment per utterance, this is hours of scrollback.
const MAX_LIVE_SEGMENTS = 2000;

type TFunction = ReturnType<typeof useTranslation>["t"];

const LANE_CODE_KEYS: Record<string, MessageKey> = {
  waiting: "meetings.lane.waiting",
  "loopback-unavailable": "meetings.lane.loopback-unavailable",
  "loopback-denied": "meetings.lane.loopback-denied",
  "microphone-unavailable": "meetings.lane.microphone-unavailable",
  "device-changed": "meetings.lane.device-changed"
};

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

const formatClock = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
};

const formatStamp = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

const formatDate = (epochMs: number): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(epochMs);

const formatSize = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDurationLabel = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(totalSeconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
};

const SPEAKER_COLORS = ["text-accent", "text-ember", "text-info"] as const;

/** Stable colour per speaker key, hashed into the three non-listening tokens. */
const speakerColor = (key: string): string => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length] ?? "text-accent";
};

const resolveSpeakerLabel = (
  key: string,
  speakers: readonly MeetingSpeaker[],
  t: TFunction
): string => {
  const assigned = speakers.find((speaker) => speaker.speakerKey === key);
  if (assigned !== undefined) return assigned.label;
  return key === "me"
    ? t("meetings.speaker.you")
    : t("meetings.speaker.numbered", { number: key.replace(/^s/, "") });
};

/**
 * The Meetings route: install card while the assets are missing, the live
 * view while a meeting runs, and the library otherwise. Detail is kept in
 * the same route, driven by meetingDetailId in the store, so the library and
 * a meeting slide between each other instead of needing a router.
 */
export function MeetingsView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const meeting = useMainStore((state) => state.meeting);
  const setMeeting = useMainStore((state) => state.setMeeting);
  const meetingDetailId = useMainStore((state) => state.meetingDetailId);
  const setMeetingDetailId = useMainStore((state) => state.setMeetingDetailId);
  const [assets, setAssets] = useState<MeetingAssetsResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [assetProgress, setAssetProgress] = useState<Record<string, MeetingAssetProgressEvent>>({});

  useEffect(() => {
    void api.meetings.assets().then((result) => {
      setAssets(result);
      // Installed builds ship these, so this is the repair path: a dev
      // checkout, or files that went missing. Start it without asking. There
      // is nothing here the user could usefully decide.
      if (!result.ready) {
        setInstalling(true);
        void api.meetings.installAssets().then((outcome) => {
          setInstalling(false);
          if (outcome.ok) {
            void api.meetings.assets().then(setAssets);
          }
        });
      }
    });
    return api.meetings.onAssetProgress((event) => {
      setAssetProgress((current) => ({ ...current, [event.assetId]: event }));
    });
  }, [api]);

  useEffect(() => {
    return api.meetings.onStateChanged(setMeeting);
  }, [api, setMeeting]);

  const active = isMeetingActive(meeting);

  if (assets !== null && !assets.ready) {
    return <SetupCard progress={assetProgress} installing={installing} />;
  }

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {active ? (
          <motion.div
            key="live"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full"
          >
            <LiveMeeting
              api={api}
              meeting={meeting}
            />
          </motion.div>
        ) : meetingDetailId !== null && meeting.phase !== "error" ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            className="h-full"
          >
            <MeetingDetail
              api={api}
              meetingId={meetingDetailId}
              onBack={() => {
                setMeetingDetailId(null);
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="library"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            className="h-full"
          >
            <MeetingLibrary
              api={api}
              errorCode={meeting.phase === "error" ? meeting.code : null}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Shown only when Meetings is not ready yet, which a normal install never
 * hits: the installer ships what a meeting needs. This is the repair path (a
 * dev checkout, or files that went missing), and it runs on its own.
 *
 * Deliberately says nothing about what is being fetched. Which models a
 * meeting uses, how many there are and what each weighs is not something
 * anybody opened this app to learn, and naming them invites a decision the
 * user has no basis to make.
 */
function SetupCard({
  progress,
  installing
}: {
  readonly progress: Record<string, MeetingAssetProgressEvent>;
  readonly installing: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const received = Object.values(progress).reduce(
    (sum, event) => (event.state === "downloading" ? sum + event.receivedBytes : sum),
    0
  );
  const failed = Object.values(progress).some((event) => event.state === "error");
  const busy =
    installing || Object.values(progress).some((event) => event.state === "downloading");

  return (
    <div className="flex h-full items-center justify-center bg-bg px-6" data-selectable>
      <Card className="w-full max-w-[420px] p-6 text-center">
        <Icon
          icon={failed ? "ph:warning-circle" : "ph:users-three"}
          className={`mx-auto mb-3 h-7 w-7 ${failed ? "text-danger" : "text-text-muted"}`}
          aria-hidden="true"
        />
        <div className="mb-1 text-base font-semibold text-text">
          {failed ? t("meetings.setup.failedTitle") : t("meetings.setup.title")}
        </div>
        <p className="text-sm text-text-secondary">
          {failed ? t("meetings.setup.failedBody") : t("meetings.setup.body")}
        </p>
        {busy && (
          <div className="mt-5">
            <ProgressBar
              value={Math.min(100, (received / REQUIRED_ASSET_BYTES) * 100)}
              label={t("meetings.setup.working")}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

function LiveMeeting({
  api,
  meeting
}: {
  readonly api: MainWindowApi;
  readonly meeting: MeetingState;
}): JSX.Element {
  const { t } = useTranslation();
  const startedAtMs = "startedAtMs" in meeting ? meeting.startedAtMs : Date.now();
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAtMs);
  const [segments, setSegments] = useState<readonly MeetingSegment[]>([]);
  const [levels, setLevels] = useState<MeetingLevelsEvent>({ system: 0, microphone: 0 });
  const [speakers, setSpeakers] = useState<readonly MeetingSpeaker[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinnedToLive, setPinnedToLive] = useState(true);
  // Every segment this meeting has produced, including ones the cap dropped.
  // Compared against what is retained so the view can say the earlier part is
  // in the saved transcript rather than appearing to lose it.
  const [totalAppended, setTotalAppended] = useState(0);
  const paused = meeting.phase === "paused";
  const activeMeetingId = meeting.phase === "recording" || meeting.phase === "paused" ? meeting.meetingId : null;
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAtMs);
    }, LIVE_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [startedAtMs]);

  useEffect(() => {
    return api.meetings.onSegmentAppended((event) => {
      if (event.meetingId !== activeMeetingId) return;
      // The live view only needs recent context; the transcript itself lives
      // in main. Keep the tail bounded so hours-long meetings do not grow
      // this array without limit.
      setTotalAppended((current) => current + 1);
      setSegments((current) => {
        const next = [...current, event.segment];
        return next.length > MAX_LIVE_SEGMENTS ? next.slice(-MAX_LIVE_SEGMENTS) : next;
      });
      setSpeakers((current) => {
        const next = [...current];
        if (!next.some((speaker) => speaker.speakerKey === event.segment.speakerKey)) {
          next.push({ speakerKey: event.segment.speakerKey, label: "" });
        }
        return next;
      });
    });
  }, [api, activeMeetingId]);

  useEffect(() => {
    return api.meetings.onLevels(setLevels);
  }, [api]);

  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8
  });

  useEffect(() => {
    if (pinnedToLive && segments.length > 0) {
      virtualizer.scrollToIndex(segments.length - 1, { align: "end" });
    }
  }, [segments.length, pinnedToLive, virtualizer]);

  const onScroll = (): void => {
    const element = scrollRef.current;
    if (element === null) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    setPinnedToLive(nearBottom);
  };

  const stop = (): void => {
    void api.meetings.stop();
  };

  const togglePause = (): void => {
    void api.meetings.pause();
  };

  const backlog = meeting.phase === "recording" ? meeting.backlogSeconds : 0;

  return (
    <div className="flex h-full flex-col" data-selectable>
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <StatusDot state="listening" />
        <span className="w-16 shrink-0 text-end text-sm font-medium tabular-nums text-text">
          {formatClock(elapsed)}
        </span>
        <div className="mx-2 h-4 w-px bg-border" />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="w-20">{t("meetings.live.systemAudio")}</span>
            <div className="h-1 w-28 overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-75 rtl:origin-right"
                style={{ transform: `scaleX(${String(meetingMeterScale(levels.system))})` }}
              />
            </div>
            {!meetingLive(meeting, "system") && meetingLaneCode(meeting, "system") !== "waiting" && (
              <span className="text-xs text-warning">{t(LANE_CODE_KEYS[meetingLaneCode(meeting, "system")] ?? "meetings.lane.waiting")}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="w-20">{t("meetings.live.microphone")}</span>
            <div className="h-1 w-28 overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full w-full origin-left rounded-full bg-ember transition-transform duration-75 rtl:origin-right"
                style={{ transform: `scaleX(${String(meetingMeterScale(levels.microphone))})` }}
              />
            </div>
            {!meetingLive(meeting, "microphone") && meetingLaneCode(meeting, "microphone") !== "waiting" && (
              <span className="text-xs text-warning">{t(LANE_CODE_KEYS[meetingLaneCode(meeting, "microphone")] ?? "meetings.lane.waiting")}</span>
            )}
          </div>
        </div>
        {backlog > 5 && (
          <span className="text-xs text-text-muted">
            {t("meetings.live.backlog", { seconds: String(backlog) })}
          </span>
        )}
        <div className="ms-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={togglePause}>
            {paused ? t("meetings.live.resume") : t("meetings.live.pause")}
          </Button>
          <Button variant="danger" size="sm" onClick={stop}>
            {t("meetings.live.stop")}
          </Button>
        </div>
      </div>
      {totalAppended > segments.length && (
        <div className="border-b border-border px-5 py-1.5 text-xs text-text-muted">
          {t("meetings.live.trimmed", { count: MAX_LIVE_SEGMENTS })}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto px-5 py-3" onScroll={onScroll}>
          {segments.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              {t("meetings.live.waiting")}
            </div>
          ) : (
            <div
              className="relative w-full"
              style={{ height: `${String(virtualizer.getTotalSize())}px` }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const segment = segments[virtualRow.index];
                if (segment === undefined) return null;
                const previous = segments[virtualRow.index - 1];
                const showSpeaker = previous === undefined || previous.speakerKey !== segment.speakerKey || previous.gap;
                return (
                  <div
                    key={segment.id}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
                  >
                    {segment.gap ? (
                      <div className="flex min-h-10 items-center gap-3 px-2 py-2">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs text-text-muted">
                          {t("meetings.row.gap", { duration: formatDurationLabel(segment.endMs - segment.startMs) })}
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    ) : (
                      <div className="flex min-h-10 items-start gap-2 px-2 py-2">
                        <span className="w-14 shrink-0 pt-0.5 text-end text-xs tabular-nums text-text-muted">
                          {formatStamp(segment.startMs)}
                        </span>
                        <span className={`w-24 shrink-0 truncate pt-0.5 text-xs font-medium ${speakerColor(segment.speakerKey)}`}>
                          {showSpeaker ? resolveSpeakerLabel(segment.speakerKey, speakers, t) : null}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-sm leading-5 text-text">
                          {segment.text}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {!pinnedToLive && segments.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setPinnedToLive(true);
              virtualizer.scrollToIndex(segments.length - 1, { align: "end" });
            }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text shadow-sm transition-colors hover:bg-surface-hover"
          >
            {t("meetings.live.jumpToLive")}
          </button>
        )}
      </div>
    </div>
  );
}

const meetingLive = (meeting: MeetingState, lane: "system" | "microphone"): boolean =>
  meeting.phase === "recording" && (lane === "system" ? meeting.system.live : meeting.microphone.live);

const meetingLaneCode = (meeting: MeetingState, lane: "system" | "microphone"): string => {
  if (meeting.phase !== "recording") return "waiting";
  const health = lane === "system" ? meeting.system : meeting.microphone;
  return health.code ?? "waiting";
};

function MeetingLibrary({
  api,
  errorCode
}: {
  readonly api: MainWindowApi;
  readonly errorCode: MeetingErrorCode | null;
}): JSX.Element {
  const { t } = useTranslation();
  const [meetings, setMeetings] = useState<readonly MeetingRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<readonly { segment: MeetingSegment; meetingTitle: string; meetingStartedAtMs: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null);
  const setMeetingDetailId = useMainStore((state) => state.setMeetingDetailId);

  const load = useCallback(
    (offset = 0): void => {
      void api.meetings.list({ limit: PAGE_SIZE, offset }).then((result) => {
        setMeetings((current) => (offset === 0 ? result.items : [...current, ...result.items]));
        setTotal(result.total);
      });
    },
    [api]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setSearching(false);
      setSearchHits([]);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api.meetings.search({ query: trimmed, limit: 50 }).then((result) => {
        setSearchHits(result.items);
        setSearching(false);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query, api]);

  const remove = (id: number): void => {
    void api.meetings.remove({ meetingId: id }).then(() => {
      setDeleteArmed(null);
      load(0);
    });
  };

  return (
    <div className="flex h-full flex-col bg-bg" data-selectable>
      {errorCode !== null && (
        <div
          role="alert"
          className="mx-5 mt-3 flex items-center gap-3 rounded-lg border border-danger bg-danger-soft px-4 py-3"
        >
          <Icon
            icon="ph:warning-circle"
            className="h-5 w-5 shrink-0 text-danger"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-text">{t("meetings.error.title")}</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {t(MEETING_ERROR_KEYS[errorCode])}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void api.meetings.start();
            }}
          >
            {t("meetings.error.retry")}
          </Button>
        </div>
      )}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("meetings.searchPlaceholder")}
          className="w-72"
        />
        <span className="text-xs text-text-muted">
          {searching ? t("meetings.searching") : t("meetings.count", { count: String(total) })}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {query.trim().length > 0 ? (
          searchHits.length === 0 ? (
            <EmptyState
              icon="ph:magnifying-glass"
              title={t("meetings.emptySearch.title")}
              body={t("meetings.emptySearch.body")}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {searchHits.map((hit) => (
                <div
                  key={`${String(hit.meetingStartedAtMs)}-${String(hit.segment.id)}`}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-text-muted">
                    <span className="font-medium text-text-secondary">{hit.meetingTitle}</span>
                    <span>{formatDate(hit.meetingStartedAtMs)}</span>
                  </div>
                  <div className="flex items-baseline gap-2 text-sm text-text">
                    <span className="w-12 shrink-0 text-xs tabular-nums text-text-muted">{formatStamp(hit.segment.startMs)}</span>
                    <span className="min-w-0 flex-1 truncate">{hit.segment.text}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : meetings.length === 0 ? (
          <EmptyState
            icon="ph:users-three"
            title={t("meetings.empty.title")}
            body={t("meetings.empty.body")}
            action={
              <div className="flex items-center gap-2 text-xs text-text-muted">
                {t("meetings.empty.hotkey")}
                <Kbd accelerator={formatAccelerator(DEFAULT_MEETING_ACCELERATOR)} />
              </div>
            }
          />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {meetings.map((meeting) => (
                <button
                  key={meeting.id}
                  type="button"
                  onClick={() => {
                    setMeetingDetailId(meeting.id);
                  }}
                  className="group flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-start transition-colors hover:border-border-strong"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">{meeting.title}</div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-text-muted">
                      <span>{formatDate(meeting.startedAtMs)}</span>
                      <span>{formatDurationLabel(meeting.durationMs)}</span>
                      <span>{t("meetings.row.speakers", { count: String(meeting.speakerCount) })}</span>
                      <span>{t("meetings.row.words", { count: String(meeting.wordCount) })}</span>
                      {meeting.audioPath !== null && (
                        <span>{formatSize(meeting.audioBytes)}</span>
                      )}
                      {meeting.state === "interrupted" && (
                        <span className="text-warning">{t("meetings.row.interrupted")}</span>
                      )}
                    </div>
                  </div>
                  {deleteArmed === meeting.id ? (
                    <div className="flex items-center gap-1.5 opacity-100">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          remove(meeting.id);
                        }}
                      >
                        {t("meetings.row.confirmDelete")}
                      </Button>
                      <span
                        role="presentation"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <IconButton
                          icon="ph:x"
                          label={t("meetings.row.cancelDelete")}
                          onClick={() => {
                            setDeleteArmed(null);
                          }}
                        />
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <span
                        role="presentation"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <IconButton
                          icon="ph:export"
                          label={t("meetings.row.export")}
                          onClick={() => {
                            void api.meetings.export({ meetingId: meeting.id, format: "markdown" });
                          }}
                        />
                      </span>
                      <span
                        role="presentation"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <IconButton
                          icon="ph:trash"
                          label={t("meetings.row.delete")}
                          onClick={() => {
                            setDeleteArmed(meeting.id);
                          }}
                        />
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
            {meetings.length < total && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="ghost"
                  onClick={() => {
                    load(meetings.length);
                  }}
                >
                  {t("meetings.row.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MeetingDetail({
  api,
  meetingId,
  onBack
}: {
  readonly api: MainWindowApi;
  readonly meetingId: number;
  readonly onBack: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null);
  const [segments, setSegments] = useState<readonly MeetingSegment[]>([]);
  const [speakers, setSpeakers] = useState<readonly MeetingSpeaker[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.meetings.get({ meetingId }).then((result) => {
      setMeeting(result.meeting);
      setSpeakers(result.speakers);
    });
    void api.meetings.segments({ meetingId, limit: 5000, offset: 0 }).then((result) => {
      setSegments(result.items);
    });
  }, [api, meetingId]);

  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8
  });

  const renameSpeaker = (key: string, label: string): void => {
    void api.meetings.renameSpeaker({ meetingId, speakerKey: key, label }).then(() => {
      setSpeakers((current) => {
        const next = current.filter((speaker) => speaker.speakerKey !== key);
        if (label.trim().length > 0) {
          next.push({ speakerKey: key, label: label.trim() });
        }
        return next;
      });
    });
  };

  const saveTitle = (): void => {
    const trimmed = titleDraft.trim();
    if (trimmed.length > 0) {
      void api.meetings.rename({ meetingId, title: trimmed }).then(() => {
        setMeeting((current) => (current === null ? null : { ...current, title: trimmed }));
      });
    }
    setEditingTitle(false);
  };

  const speakerKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const segment of segments) {
      if (!segment.gap) keys.add(segment.speakerKey);
    }
    return [...keys];
  }, [segments]);

  if (meeting === null) {
    return <div className="h-full bg-bg" />;
  }

  return (
    <div className="flex h-full flex-col bg-bg" data-selectable>
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <IconButton
          icon="ph:arrow-left"
          label={t("meetings.detail.back")}
          onClick={onBack}
        />
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(event) => {
              setTitleDraft(event.target.value);
            }}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveTitle();
              if (event.key === "Escape") setEditingTitle(false);
            }}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text focus:outline-none"
          />
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-start text-sm font-medium text-text hover:underline"
            onClick={() => {
              setTitleDraft(meeting.title);
              setEditingTitle(true);
            }}
          >
            {meeting.title}
          </button>
        )}
        <span className="text-xs text-text-muted">
          {formatDate(meeting.startedAtMs)} · {formatDurationLabel(meeting.durationMs)}
        </span>
        <div className="flex items-center gap-1.5">
          {(["markdown", "text", "srt"] as const).map((format) => (
            <Button
              key={format}
              variant="ghost"
              size="sm"
              onClick={() => {
                void api.meetings.export({ meetingId, format });
              }}
            >
              {format.toUpperCase()}
            </Button>
          ))}
          {meeting.audioPath !== null && (
            <IconButton
              icon="ph:folder-open"
              label={t("meetings.detail.revealRecording")}
              onClick={() => {
                void api.meetings.revealRecording({ meetingId });
              }}
            />
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-5 py-3">
          {segments.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              {t("meetings.detail.empty")}
            </div>
          ) : (
            <div className="relative w-full" style={{ height: `${String(virtualizer.getTotalSize())}px` }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const segment = segments[virtualRow.index];
                if (segment === undefined) return null;
                const previous = segments[virtualRow.index - 1];
                const showSpeaker = previous === undefined || previous.speakerKey !== segment.speakerKey || previous.gap;
                return (
                  <div
                    key={segment.id}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
                  >
                    {segment.gap ? (
                      <div className="flex min-h-10 items-center gap-3 px-2 py-2">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs text-text-muted">
                          {t("meetings.row.gap", { duration: formatDurationLabel(segment.endMs - segment.startMs) })}
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    ) : (
                      <div className="flex min-h-10 items-start gap-2 px-2 py-2">
                        <span className="w-14 shrink-0 pt-0.5 text-end text-xs tabular-nums text-text-muted">
                          {formatStamp(segment.startMs)}
                        </span>
                        <span className={`w-24 shrink-0 truncate pt-0.5 text-xs font-medium ${speakerColor(segment.speakerKey)}`}>
                          {showSpeaker ? resolveSpeakerLabel(segment.speakerKey, speakers, t) : null}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-sm leading-5 text-text">
                          {segment.text}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <aside className="w-56 shrink-0 border-l border-border p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t("meetings.detail.speakers")}
          </div>
          <div className="flex flex-col gap-2">
            {speakerKeys.map((key) => (
              <SpeakerRow
                key={key}
                speakerKey={key}
                label={resolveSpeakerLabel(key, speakers, t)}
                onRename={(label) => {
                  renameSpeaker(key, label);
                }}
              />
            ))}
            {speakerKeys.length === 0 && (
              <div className="text-xs text-text-muted">{t("meetings.detail.noSpeakers")}</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SpeakerRow({
  speakerKey,
  label,
  onRename
}: {
  readonly speakerKey: string;
  readonly label: string;
  readonly onRename: (label: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${speakerColor(speakerKey).replace("text-", "bg-")}`} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={() => {
            onRename(draft);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onRename(draft);
              setEditing(false);
            }
            if (event.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-text focus:outline-none"
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-start text-xs text-text hover:underline"
          onClick={() => {
            setDraft(label);
            setEditing(true);
          }}
        >
          {label}
        </button>
      )}
      <button
        type="button"
        className="text-xs text-text-muted hover:text-text"
        onClick={() => {
          setDraft(label);
          setEditing(true);
        }}
        aria-label={t("meetings.detail.renameSpeaker")}
      >
        <Icon icon="ph:pencil-simple" className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
