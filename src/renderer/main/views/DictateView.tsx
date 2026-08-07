import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { useMainStore } from "../store/use-main-store";
import { PageBody } from "../components/PageHeader";
import { MicrophoneMeter } from "../components/MicrophoneMeter";
import { Button, IconButton, Kbd, SettingsGroup, Skeleton, StatTile, StatusDot } from "../components/ui";
import { HistoryChart } from "../components/HistoryChart";
import type { MainWindowApi } from "../../../shared/api";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import type { ModelStatus } from "../../../shared/models";
import { findModel } from "../../../shared/models";
import { ENGINE_OPTIONS } from "../../../shared/engines";
import type { HistoryStatsResult, TranscriptRecord } from "../../../shared/ipc";
import type { MeetingState } from "../../../shared/meeting";
import { isMeetingActive } from "../../../shared/meeting";
import { formatRelativeTime } from "../lib/format";

/**
 * The home view: a dashboard, not a setup wizard. It shows what you have
 * dictated, because that is the question you have every day. Whether the app
 * is configured is a question you have once, so readiness only appears here
 * when something is actually broken.
 */

const EMPTY_STATS: HistoryStatsResult = {
  todayWords: 0,
  todayDurationMs: 0,
  todayCount: 0,
  wpm: 0,
  streakDays: 0,
  totalTranscripts: 0,
  totalWords: 0,
  totalDurationMs: 0,
  daily: []
};

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(totalSeconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
};



interface Blocker {
  readonly message: string;
  readonly action: string;
  readonly run: () => void;
}

import { useTranslation } from "../lib/useTranslation";

/**
 * The compact recording bar on the Dictate view while a meeting runs. It must
 * be impossible to forget that the machine is recording, and this is where a
 * user looking at the home view will see it.
 */
function MeetingBar({
  meeting,
  onOpen,
  onStop
}: {
  readonly meeting: MeetingState;
  readonly onOpen: () => void;
  readonly onStop: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  const startedAtMs = meeting.phase === "recording" || meeting.phase === "paused" ? meeting.startedAtMs : Date.now();

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAtMs);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [startedAtMs]);

  const totalSeconds = Math.max(0, Math.floor(elapsed / 1000));
  const pad = (n: number): string => String(n).padStart(2, "0");
  const clock = `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface px-5 py-2">
      <StatusDot state="listening" />
      <span className="text-sm font-medium tabular-nums text-text">{clock}</span>
      <button
        type="button"
        className="text-sm text-accent hover:underline"
        onClick={onOpen}
      >
        {t("meetings.bar.open")}
      </button>
      <div className="ms-auto">
        <Button variant="danger" size="sm" onClick={onStop}>
          {t("meetings.bar.stop")}
        </Button>
      </div>
    </div>
  );
}

export function DictateView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const { t } = useTranslation();
  const capture = useMainStore((state) => state.capture);
  const shellRevealed = useMainStore((state) => state.shellRevealed);
  const setRoute = useMainStore((state) => state.setRoute);
  const meeting = useMainStore((state) => state.meeting);
  const meetingActive = isMeetingActive(meeting);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<readonly ModelStatus[]>([]);
  const [recent, setRecent] = useState<readonly TranscriptRecord[]>([]);
  const [stats, setStats] = useState<HistoryStatsResult>(EMPTY_STATS);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [keyConfigured, setKeyConfigured] = useState(false);

  useEffect(() => {
    void api.settings.get().then(({ settings: loaded }) => {
      setSettings(loaded);
    });
    return api.settings.onChange(setSettings);
  }, [api]);

  useEffect(() => {
    void api.models.list().then(({ items }) => {
      setModels(items);
    });
    void api.openRouterKey.status().then(({ configured }) => {
      setKeyConfigured(configured);
    });
  }, [api]);

  // Re-read after every capture so a fresh transcript lands in both the list
  // and the counters without a manual refresh.
  useEffect(() => {
    void api.history.list({ limit: 5 }).then(({ items }) => {
      setRecent(items);
    });
    void api.history.stats().then((result) => {
      setStats(result);
      setStatsLoaded(true);
    });
  }, [api, capture.phase]);

  useEffect(() => {
    return api.onCaptureLevelsChanged(({ level: next }) => {
      setLevel((current) => Math.max(current * 0.6, next * 0.4));
    });
  }, [api]);

  useEffect(() => {
    if (copiedId === null) return;
    const timer = window.setTimeout(() => {
      setCopiedId(null);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copiedId]);

  const openSettingsCategory = useCallback(
    (category: string): void => {
      setRoute("settings");
      window.dispatchEvent(new CustomEvent("struq:open-settings-category", { detail: category }));
    },
    [setRoute]
  );

  const engine = ENGINE_OPTIONS.find((option) => option.id === settings.engine.primary);
  const engineModelId =
    settings.engine.primary === "whisper-cpp"
      ? settings.whisperModelId
      : "parakeet-tdt-0.6b-v3-int8";
  const modelStatus = models.find((entry) => entry.model.id === engineModelId);
  const isLocal = engine?.kind === "local";
  const isCloud = engine?.kind === "cloud";
  const blocker: Blocker | null =
    isLocal && modelStatus?.installed !== true
      ? {
          message: t("dictate.blocker.localMissing.message", {
            model: findModel(engineModelId)?.name ?? "Model"
          }),
          action: t("dictate.blocker.localMissing.action"),
          run: () => {
            setRoute("models");
          }
        }
      : isCloud && !keyConfigured
        ? {
            message: t("dictate.blocker.cloudKey.message"),
            action: t("dictate.blocker.cloudKey.action"),
            run: () => {
              openSettingsCategory("transcription");
            }
          }
        : null;

  const phaseLabelMap: Record<string, string> = {
    arming: t("dictate.phase.arming"),
    listening: t("dictate.phase.listening"),
    transcribing: t("dictate.phase.transcribing"),
    delivering: t("dictate.phase.delivering"),
    error: t("dictate.phase.error")
  };
  const phaseLabel = phaseLabelMap[capture.phase];

  return (
    <div className="flex h-full flex-col bg-bg">
      {meetingActive && (
        <MeetingBar
          meeting={meeting}
          onOpen={() => {
            setRoute("meetings");
          }}
          onStop={() => {
            void api.meetings.stop();
          }}
        />
      )}
      <PageBody>
        {blocker !== null && (
          <div className="flex items-center gap-3 rounded-lg border border-warning bg-warning-soft px-4 py-3">
            <Icon icon="ph:warning" className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm text-text">{blocker.message}</p>
            <Button variant="secondary" size="sm" onClick={blocker.run}>
              {blocker.action}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            icon="ph:article"
            label={t("dictate.stats.words")}
            value={stats.todayWords.toLocaleString()}
            hint={t("dictate.stats.today")}
          />
          <StatTile
            icon="ph:timer"
            label={t("dictate.stats.spoken")}
            value={formatDuration(stats.todayDurationMs)}
            hint={t("dictate.stats.today")}
          />
          <StatTile
            icon="ph:trend-up"
            label={t("dictate.stats.pace")}
            value={stats.wpm > 0 ? String(stats.wpm) : "--"}
            hint={t("dictate.stats.wpmHint")}
          />
          <StatTile
            icon="ph:flame"
            label={t("dictate.stats.streak")}
            value={String(stats.streakDays)}
            hint={stats.streakDays === 1 ? t("dictate.stats.day") : t("dictate.stats.days")}
          />
        </div>

        {!statsLoaded || !shellRevealed ? (
          <div className="flex h-52 flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3.5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-36 w-full rounded-md" />
          </div>
        ) : (
          stats.totalTranscripts > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-normal text-text-muted">{t("dictate.activity.title")}</span>
                <span className="text-2xs font-normal text-text-muted" data-numeric>
                  {t("dictate.activity.summary", {
                    totalWords: stats.totalWords.toLocaleString(),
                    duration: formatDuration(stats.totalDurationMs)
                  })}
                </span>
              </div>
              <HistoryChart days={stats.daily} />
            </div>
          )
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Icon
                icon={capture.phase === "listening" ? "ph:microphone" : "ph:keyboard"}
                className={
                  phaseLabel === undefined
                    ? "h-4 w-4 shrink-0 text-text-muted"
                    : capture.phase === "listening"
                      ? "h-4 w-4 shrink-0 text-capture"
                      : capture.phase === "transcribing"
                        ? "h-4 w-4 shrink-0 text-info"
                        : "h-4 w-4 shrink-0 text-accent"
                }
                aria-hidden="true"
              />
              <span className="truncate text-sm font-medium text-text">
                {phaseLabel ?? t("dictate.prompt.default")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Kbd accelerator={settings.pttAccelerator} size="md" />
              <span className="text-xs text-text-muted">{t("dictate.prompt.or")}</span>
              <Kbd accelerator={settings.toggleAccelerator} size="md" />
            </div>
          </div>
          <MicrophoneMeter level={level} />
        </div>

        <SettingsGroup
          title={t("dictate.recent.title")}
          actions={
            recent.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRoute("history");
                }}
              >
                {t("dictate.recent.viewAll")}
                <Icon icon="ph:arrow-right" className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : undefined
          }
        >
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted">
              {t("dictate.recent.empty")}
            </p>
          ) : (
            recent.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => {
                  api.clipboard.copy(record.text);
                  setCopiedId(record.id);
                }}
                className="group flex w-full cursor-pointer items-center gap-3 rounded-md px-4 py-2.5 text-start transition-colors duration-hover hover:bg-surface-hover/80"
              >
                <p className="min-w-0 flex-1 truncate text-sm text-text">{record.text}</p>
                <span className="shrink-0 text-2xs text-text-muted" data-numeric>
                  {formatRelativeTime(record.createdAtMs)}
                </span>
                {copiedId === record.id ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center text-success">
                    <Icon icon="ph:check" className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                ) : (
                  <IconButton
                    icon="ph:copy"
                    label={t("dictate.recent.copyTranscript")}
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      api.clipboard.copy(record.text);
                      setCopiedId(record.id);
                    }}
                  />
                )}
              </button>
            ))
          )}
        </SettingsGroup>
      </PageBody>
    </div>
  );
}
