import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Copy } from "lucide-react";
import type { MainWindowApi } from "../../../shared/api";
import type { ModelStatus } from "../../../shared/models";
import type { RecorderDevice } from "../../../shared/ipc";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import { MOCK_ENGINE_ID, engineOption } from "../../../shared/engines";
import { findModel } from "../../../shared/models";
import { useMainStore } from "../store/use-main-store";
import type { Route } from "../store/use-main-store";
import { Badge, Button, Card, Kbd, StatusDot } from "../components/ui";

/**
 * The home view: whether the app is ready, and the last thing it heard.
 *
 * Every readiness row states what is true now, and a row that is not ready
 * names the cause and offers the fix in the same place. A status display that
 * reports a problem without a way to act on it is a dead end.
 */

const PHASE_HINTS: Record<string, { label: string; detail: string }> = {
  idle: { label: "Ready", detail: "Hold your key anywhere in Windows and speak." },
  arming: { label: "Warming up", detail: "The microphone is reconnecting." },
  listening: { label: "Listening", detail: "Speak. Release to transcribe." },
  transcribing: { label: "Transcribing", detail: "Turning the audio into text." },
  delivering: { label: "Delivered", detail: "The text is in the focused window." },
  error: { label: "Something failed", detail: "The last capture did not land." }
};

const FALLBACK_HINT = PHASE_HINTS["idle"] as { label: string; detail: string };

interface ReadinessRow {
  readonly label: string;
  readonly value: string;
  readonly ready: boolean;
  readonly fix?: { readonly action: string; readonly route: Route };
}

export function DictateView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const capture = useMainStore((state) => state.capture);
  const setRoute = useMainStore((state) => state.setRoute);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [devices, setDevices] = useState<readonly RecorderDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [models, setModels] = useState<readonly ModelStatus[]>([]);
  const [lastText, setLastText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
  }, [api]);

  useEffect(() => {
    void api.history.list({ limit: 1 }).then(({ items }) => {
      setLastText(items[0]?.text ?? null);
    });
  }, [api, capture.phase]);

  const hint = PHASE_HINTS[capture.phase] ?? FALLBACK_HINT;
  const engine = engineOption(settings.engine.primary);
  const device = devices.find((entry) => entry.deviceId === currentDeviceId) ?? devices[0];

  // A local engine is only usable once its model is on disk, so readiness is
  // the model's state and not merely which engine is selected.
  const engineModelId =
    settings.engine.primary === "whisper-cpp" ? settings.whisperModelId : "parakeet-tdt-0.6b-v3-int8";
  const modelStatus = models.find((entry) => entry.model.id === engineModelId);
  const isLocal = engine?.kind === "local";
  const engineLabel = engine?.displayName ?? settings.engine.primary;
  const modelLabel = findModel(engineModelId)?.name ?? "The model";
  const engineReady =
    settings.engine.primary !== MOCK_ENGINE_ID && (!isLocal || modelStatus?.installed === true);

  const rows: readonly ReadinessRow[] = [
    {
      label: "Microphone",
      value: device?.label ?? "No microphone detected",
      ready: devices.length > 0,
      ...(devices.length > 0 ? {} : { fix: { action: "Open Settings", route: "settings" as const } })
    },
    {
      label: "Engine",
      value:
        settings.engine.primary === MOCK_ENGINE_ID
          ? "Mock, which returns fixed text instead of transcribing"
          : isLocal && modelStatus?.installed !== true
            ? `${engineLabel}: ${modelLabel} is not downloaded`
            : `${engineLabel}, ${engine?.kind === "cloud" ? "cloud" : "on this machine"}`,
      ready: engineReady,
      ...(engineReady
        ? {}
        : {
            fix: {
              action: settings.engine.primary === MOCK_ENGINE_ID ? "Choose an engine" : "Download it",
              route: "models" as const
            }
          })
    }
  ];

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <header>
          <h1 className="font-serif text-2xl tracking-tight text-text">Dictate</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-text-muted">
            <StatusDot phase={capture.phase} />
            {hint.label}. {hint.detail}
          </p>
        </header>

        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-text">Hold to record</h2>
              <p className="mt-0.5 text-sm text-text-muted">
                Works in any window. The text lands where your cursor is.
              </p>
            </div>
            <Kbd accelerator={settings.pttAccelerator} size="md" />
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            {rows.map((row) => {
              const fix = row.fix;
              return (
                <div key={row.label} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-text">{row.label}</p>
                    <p className="truncate text-sm text-text-muted">{row.value}</p>
                  </div>
                  {row.ready ? (
                    <Badge tone="success">Ready</Badge>
                  ) : fix !== undefined ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setRoute(fix.route);
                      }}
                    >
                      {fix.action}
                    </Button>
                  ) : (
                    <Badge tone="warning">Not ready</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <section>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-base font-semibold text-text">Last transcript</h2>
            {lastText !== null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  api.clipboard.copy(lastText);
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                  }, 1200);
                }}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </div>
          {lastText === null ? (
            <p className="mt-3 text-sm text-text-muted">
              Nothing yet. Hold your key, say a sentence, and it appears here.
            </p>
          ) : (
            <p className="mt-3 max-w-prose font-serif text-lg leading-prose text-text">
              {lastText}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
