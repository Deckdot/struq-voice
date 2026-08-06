import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { useMainStore } from "../store/use-main-store";
import { Badge, Button, Card, Kbd, SettingsGroup, SettingsRow, StatusDot } from "../components/ui";
import type { MainWindowApi } from "../../../shared/api";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import type { ModelStatus } from "../../../shared/models";
import { findModel } from "../../../shared/models";
import { ENGINE_OPTIONS } from "../../../shared/engines";
import type { RecorderDevice } from "../../../shared/ipc";
import type { TranscriptRecord } from "../../../shared/ipc";

/**
 * The home view. It answers the one question a person opens Struq Voice
 * with: is it ready? Everything else (the keyboard, the engine, the last
 * transcript) is supporting evidence.
 *
 * Copy rules: never use "engine", "binary", "RTF", "FTS5", "IPC",
 * "endpoint". The voice service, the helper, the speed, the languages.
 * Names of internal models (Parakeet, Whisper) are fine when introduced
 * as the name of the thing doing the work.
 */

const PHASE_HINT: Record<string, { label: string; detail: string }> = {
  idle: {
    label: "Ready",
    detail: "Hold your key, speak, and release. The words land where your cursor was."
  },
  arming: { label: "Starting up", detail: "Reopening the microphone." },
  listening: { label: "Listening", detail: "Speak. Release your key when you are done." },
  transcribing: { label: "Turning your words into text", detail: "One moment." },
  delivering: { label: "Done", detail: "The text is in the window you were using." },
  error: { label: "Something went wrong", detail: "The last attempt did not finish." }
};

interface ReadinessRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly ready: boolean;
  readonly fix?: { readonly label: string; readonly route: "settings" | "models"; readonly category?: string };
}

const formatPhase = (phase: string): { label: string; detail: string } => {
  const value = PHASE_HINT[phase];
  if (value !== undefined) return value;
  const fallback = PHASE_HINT["idle"];
  if (fallback !== undefined) return fallback;
  return { label: "Ready", detail: "Hold your key, speak, and release." };
};

export function DictateView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const capture = useMainStore((state) => state.capture);
  const setRoute = useMainStore((state) => state.setRoute);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [devices, setDevices] = useState<readonly RecorderDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [models, setModels] = useState<readonly ModelStatus[]>([]);
  const [latest, setLatest] = useState<TranscriptRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [level, setLevel] = useState(0);
  const [keyConfigured, setKeyConfigured] = useState(false);

  useEffect(() => {
    void api.settings.get().then(({ settings: loaded }) => {
      setSettings(loaded);
    });
    return api.settings.onChange(setSettings);
  }, [api]);

  useEffect(() => {
    void api.devices.list().then(({ devices: list, currentDeviceId: id }) => {
      setDevices(list);
      setCurrentDeviceId(id);
    });
    void api.models.list().then(({ items }) => {
      setModels(items);
    });
    void api.openRouterKey.status().then(({ configured }) => {
      setKeyConfigured(configured);
    });
  }, [api]);

  useEffect(() => {
    void api.history.list({ limit: 1 }).then(({ items }) => {
      setLatest(items[0] ?? null);
    });
  }, [api, capture.phase]);

  useEffect(() => {
    return api.onCaptureLevelsChanged(({ level: next }) => {
      setLevel((current) => Math.max(current * 0.6, next * 0.4));
    });
  }, [api]);

  const hint = formatPhase(capture.phase);
  const engine = ENGINE_OPTIONS.find((option) => option.id === settings.engine.primary);
  const device = devices.find((entry) => entry.deviceId === currentDeviceId) ?? devices[0];

  const engineModelId =
    settings.engine.primary === "whisper-cpp"
      ? settings.whisperModelId
      : "parakeet-tdt-0.6b-v3-int8";
  const modelStatus = models.find((entry) => entry.model.id === engineModelId);
  const modelLabel = findModel(engineModelId)?.name ?? "the model";

  const isLocal = engine?.kind === "local";
  const isCloud = engine?.kind === "cloud";
  const isMock = settings.engine.primary === "mock";
  const engineReady =
    !isMock && (!isLocal || modelStatus?.installed === true) && (!isCloud || keyConfigured);

  const rows: readonly ReadinessRow[] = [
    {
      id: "mic",
      label: "Microphone",
      value: device?.label ?? "No microphone connected",
      ready: devices.length > 0,
      ...(devices.length === 0
        ? { fix: { label: "Choose a microphone", route: "settings", category: "capture" } }
        : {})
    },
    {
      id: "engine",
      label: "Voice service",
      value: isMock
        ? "Practice mode. Switch on a real service to transcribe."
        : isLocal && modelStatus?.installed !== true
          ? `${modelLabel} is not on this computer yet.`
          : isCloud && !keyConfigured
            ? "OpenRouter needs an API key."
            : `${engine?.displayName ?? settings.engine.primary} is ready.`,
      ready: engineReady,
      ...(engineReady
        ? {}
        : isMock
          ? { fix: { label: "Choose a service", route: "settings", category: "transcription" } }
          : isLocal
            ? { fix: { label: "Download it", route: "models" } }
            : { fix: { label: "Add a key", route: "settings", category: "transcription" } })
    }
  ];

  const readyHeadline = rows.every((row) => row.ready)
    ? "Ready when you are."
    : rows.find((row) => !row.ready)?.value ?? "Ready when you are.";

  const meterWidth = Math.min(100, Math.round(level * 100));

  const openSettingsCategory = (category: string): void => {
    setRoute("settings");
    window.dispatchEvent(new CustomEvent("struq:open-settings-category", { detail: category }));
  };

  return (
    <div className="h-full overflow-y-auto bg-bg" data-selectable>
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-8 px-8 py-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <StatusDot
              state={
                capture.phase === "error"
                  ? "error"
                  : capture.phase === "listening" || capture.phase === "arming"
                    ? "listening"
                    : capture.phase === "transcribing"
                      ? "transcribing"
                      : capture.phase === "delivering"
                        ? "delivering"
                        : engineReady
                          ? "ready"
                          : "idle"
              }
            />
            <span>{hint.label}</span>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
            {readyHeadline}
          </h1>
          <p className="max-w-prose text-sm text-text-muted">{hint.detail}</p>
        </header>

        <Card className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text">Hold to speak</h2>
              <p className="mt-0.5 text-sm text-text-muted">
                Works anywhere in Windows. The text lands where your cursor is.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Kbd accelerator={settings.pttAccelerator} size="md" />
              <span className="text-xs text-text-muted">or</span>
              <Kbd accelerator={settings.toggleAccelerator} size="md" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div
              className="h-1 w-full overflow-hidden rounded-pill bg-bg-sunken"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={meterWidth}
              aria-label="Microphone level"
            >
              <div
                className="h-full rounded-pill bg-accent transition-[width] duration-75"
                style={{ width: `${String(meterWidth)}%` }}
              />
            </div>
            <p className="text-2xs text-text-muted">Live microphone level</p>
          </div>
        </Card>

        <SettingsGroup
          title="Status"
          description="If anything here is not ready, tap the button on its right to fix it."
        >
          {rows.map((row) => (
            <SettingsRow
              key={row.id}
              label={row.label}
              hint={row.value}
              control={
                row.ready ? (
                  <Badge tone="success" icon="ph:check-circle">
                    Ready
                  </Badge>
                ) : row.fix !== undefined ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (row.fix?.route === "models") {
                        setRoute("models");
                        return;
                      }
                      if (row.fix?.category !== undefined) {
                        openSettingsCategory(row.fix.category);
                        return;
                      }
                      setRoute(row.fix?.route ?? "settings");
                    }}
                  >
                    {row.fix.label}
                  </Button>
                ) : (
                  <Badge tone="warning" icon="ph:warning-circle">
                    Not ready
                  </Badge>
                )
              }
            />
          ))}
        </SettingsGroup>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-text">Your last transcript</h2>
              <p className="mt-0.5 text-sm text-text-muted">
                Struq Voice saves everything you dictate. Find older ones in History.
              </p>
            </div>
            {latest !== null && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  api.clipboard.copy(latest.text);
                  setCopied(true);
                  window.setTimeout(() => {
                    setCopied(false);
                  }, 1200);
                }}
              >
                <Icon
                  icon={copied ? "ph:check" : "ph:copy"}
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </div>
          {latest === null ? (
            <Card>
              <p className="text-sm text-text-muted">
                Nothing here yet. Hold your key, say something, and it will appear.
              </p>
            </Card>
          ) : (
            <Card>
              <p className="text-md leading-prose text-text" data-selectable>
                {latest.text}
              </p>
            </Card>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-semibold text-text">What lives where</h2>
          <p className="text-sm text-text-muted">
            A quick map of the app. You will not need most of these very often.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card>
              <div className="flex items-start gap-3">
                <Icon icon="ph:clock-counter-clockwise" className="mt-0.5 h-4 w-4 text-text-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">History</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Every transcript, with search. Press <Kbd accelerator="CommandOrControl+1" size="sm" /> to jump there.
                  </p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-start gap-3">
                <Icon icon="ph:cube" className="mt-0.5 h-4 w-4 text-text-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">Models</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    The voice helpers on this computer. Download more, or import one you already have.
                  </p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-start gap-3">
                <Icon icon="ph:gear" className="mt-0.5 h-4 w-4 text-text-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">Settings</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Microphone, shortcuts, theme, the words Struq Voice learns to fix.
                  </p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-start gap-3">
                <Icon icon="ph:command" className="mt-0.5 h-4 w-4 text-text-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">Command palette</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Press <Kbd accelerator="CommandOrControl+K" size="sm" /> to search everything Struq Voice can do.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {isMock && (
          <Card className="border-warning bg-warning-soft">
            <div className="flex items-start gap-3">
              <Icon icon="ph:warning-circle" className="mt-0.5 h-4 w-4 text-warning" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-text">You are still in practice mode.</p>
                <p className="mt-1 text-sm text-text-muted">
                  Struq Voice will return fixed text instead of transcribing. Switch on a real service in Settings.
                </p>
                <Button
                  className="mt-3"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    openSettingsCategory("transcription");
                  }}
                >
                  Open Settings
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Hint pinned at the bottom for keyboard shortcuts, kept tiny. */}
        <p className="mt-2 text-2xs text-text-muted">
          Press <Kbd accelerator="CommandOrControl+K" size="sm" /> to open the command palette. The microphone, engine and word-replacement rules live in Settings.
        </p>
      </div>
    </div>
  );
}
