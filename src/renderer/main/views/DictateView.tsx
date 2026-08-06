import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { useMainStore } from "../store/use-main-store";
import { PageBody } from "../components/PageHeader";
import { MicrophoneMeter } from "../components/MicrophoneMeter";
import { Button, IconButton, Kbd, SettingsGroup, StatTile } from "../components/ui";
import { HistoryChart } from "../components/HistoryChart";
import type { MainWindowApi } from "../../../shared/api";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import type { ModelStatus } from "../../../shared/models";
import { findModel } from "../../../shared/models";
import { ENGINE_OPTIONS } from "../../../shared/engines";
import type { HistoryStatsResult, TranscriptRecord } from "../../../shared/ipc";
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

const PHASE_LABEL: Record<string, string> = {
  arming: "Starting the microphone",
  listening: "Listening",
  transcribing: "Writing it down",
  delivering: "Delivered",
  error: "That capture failed"
};

interface Blocker {
  readonly message: string;
  readonly action: string;
  readonly run: () => void;
}

export function DictateView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const capture = useMainStore((state) => state.capture);
  const setRoute = useMainStore((state) => state.setRoute);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<readonly ModelStatus[]>([]);
  const [recent, setRecent] = useState<readonly TranscriptRecord[]>([]);
  const [stats, setStats] = useState<HistoryStatsResult>(EMPTY_STATS);
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
    void api.history.stats().then(setStats);
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
  const isMock = settings.engine.primary === "mock";

  const blocker: Blocker | null = isMock
    ? {
        message: "Practice mode returns fixed text instead of transcribing.",
        action: "Choose a service",
        run: () => {
          openSettingsCategory("transcription");
        }
      }
    : isLocal && modelStatus?.installed !== true
      ? {
          message: `${findModel(engineModelId)?.name ?? "The model"} is not on this computer yet.`,
          action: "Download it",
          run: () => {
            setRoute("models");
          }
        }
      : isCloud && !keyConfigured
        ? {
            message: "OpenRouter needs an API key before it can transcribe.",
            action: "Add a key",
            run: () => {
              openSettingsCategory("transcription");
            }
          }
        : null;

  const phaseLabel = PHASE_LABEL[capture.phase];
  return (
    <div className="flex h-full flex-col bg-bg">
      <PageBody>
        <div>
          <h1 className="font-display text-2xl font-normal tracking-tight text-text">Dictate</h1>
          <p className="mt-1 text-sm text-text-muted">Your voice workspace is ready wherever you type.</p>
        </div>
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
            label="Words"
            value={stats.todayWords.toLocaleString()}
            hint="today"
          />
          <StatTile
            icon="ph:timer"
            label="Spoken"
            value={formatDuration(stats.todayDurationMs)}
            hint="today"
          />
          <StatTile
            icon="ph:trend-up"
            label="Pace"
            value={stats.wpm > 0 ? String(stats.wpm) : "--"}
            hint="words per minute"
          />
          <StatTile
            icon="ph:flame"
            label="Streak"
            value={String(stats.streakDays)}
            hint={stats.streakDays === 1 ? "day" : "days"}
          />
        </div>

        {stats.totalTranscripts > 0 && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-normal text-text-muted">Dictation Activity</span>
              <span className="text-2xs font-normal text-text-muted" data-numeric>
                {stats.totalWords.toLocaleString()} words all time · {formatDuration(stats.totalDurationMs)}
              </span>
            </div>
            <HistoryChart days={stats.daily} />
          </div>
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
                      ? "h-4 w-4 shrink-0 text-success"
                      : capture.phase === "transcribing"
                        ? "h-4 w-4 shrink-0 text-info"
                        : "h-4 w-4 shrink-0 text-accent"
                }
                aria-hidden="true"
              />
              <span className="truncate text-sm font-medium text-text">
                {phaseLabel ?? "Hold to speak, anywhere in Windows"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Kbd accelerator={settings.pttAccelerator} size="md" />
              <span className="text-xs text-text-muted">or</span>
              <Kbd accelerator={settings.toggleAccelerator} size="md" />
            </div>
          </div>
          <MicrophoneMeter level={level} />
        </div>

        <SettingsGroup
          title="Recent"
          actions={
            recent.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRoute("history");
                }}
              >
                View all
                <Icon icon="ph:arrow-right" className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : undefined
          }
        >
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted">
              Nothing yet. Hold your key and say a sentence.
            </p>
          ) : (
            recent.map((record) => (
              <div key={record.id} className="group flex items-center gap-3 px-4 py-2.5">
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
                    label="Copy transcript"
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      api.clipboard.copy(record.text);
                      setCopiedId(record.id);
                    }}
                  />
                )}
              </div>
            ))
          )}
        </SettingsGroup>
      </PageBody>
    </div>
  );
}
