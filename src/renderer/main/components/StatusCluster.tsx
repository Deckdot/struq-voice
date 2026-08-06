import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi, RecorderDevice } from "../../../shared/api";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import { formatAccelerator } from "../../../shared/hotkeys";
import { MOCK_ENGINE_ID, engineOption } from "../../../shared/engines";
import type { ModelStatus } from "../../../shared/models";
import { useMainStore } from "../store/use-main-store";
import { Badge, StatusDot } from "./ui";

const ROW_CLASS =
  "flex cursor-pointer items-center gap-2 text-left text-xs transition-colors duration-hover hover:text-text";

const openSettingsCategory = (category: string): void => {
  useMainStore.getState().setRoute("settings");
  window.dispatchEvent(new CustomEvent("struq:open-settings-category", { detail: category }));
};

/**
 * The live readiness cluster at the bottom of the rail: microphone, hotkey
 * and voice engine, each showing a dot for its state and a value that names
 * what is wrong when it is not ready. Rows navigate to the settings tab that
 * can fix them.
 */
export function StatusCluster(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const readiness = useMainStore((state) => state.readiness);
  const setRoute = useMainStore((state) => state.setRoute);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [devices, setDevices] = useState<readonly RecorderDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [models, setModels] = useState<readonly ModelStatus[]>([]);
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
  }, [api]);

  useEffect(() => {
    void api.devices.list().then(({ devices: list, currentDeviceId: id }) => {
      setDevices(list);
      setCurrentDeviceId(id);
    });
  }, [api, readiness.microphone.live]);

  const engine = engineOption(settings.engine.primary);
  const isLocal = engine?.kind === "local";
  const isCloud = engine?.kind === "cloud";
  const engineModelId =
    settings.engine.primary === "whisper-cpp"
      ? settings.whisperModelId
      : "parakeet-tdt-0.6b-v3-int8";
  const modelStatus = models.find((entry) => entry.model.id === engineModelId);

  useEffect(() => {
    if (!isCloud) return;
    let cancelled = false;
    void api.openRouterKey.status().then(({ configured }) => {
      if (!cancelled) setKeyConfigured(configured);
    });
    return () => {
      cancelled = true;
    };
  }, [api, isCloud]);

  const engineReady =
    settings.engine.primary !== MOCK_ENGINE_ID &&
    (isLocal ? modelStatus?.installed === true : isCloud ? keyConfigured : false);

  const device = devices.find((entry) => entry.deviceId === currentDeviceId) ?? devices[0];
  const micLive = readiness.microphone.live;
  const micValue = micLive
    ? (device?.label ?? "Microphone")
    : (readiness.microphone.reason ?? device?.label ?? "Off");

  const engineValue = engineReady
    ? (engine?.displayName ?? settings.engine.primary)
    : isCloud && !keyConfigured
      ? "Need API key"
      : isLocal && modelStatus?.installed !== true
        ? "Not downloaded"
        : (engine?.displayName ?? settings.engine.primary);

  const openEngine = (): void => {
    if (!engineReady) {
      if (isCloud) {
        openSettingsCategory("transcription");
        return;
      }
      setRoute("models");
      return;
    }
    openSettingsCategory("transcription");
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
      <button
        type="button"
        onClick={() => {
          openSettingsCategory("capture");
        }}
        className={ROW_CLASS}
      >
        <StatusDot state={micLive ? "ready" : "off"} size="sm" />
        <span className="w-[64px] shrink-0 text-text-muted">Microphone</span>
        <span className="min-w-0 flex-1 truncate text-text">{micValue}</span>
      </button>

      <button
        type="button"
        onClick={() => {
          openSettingsCategory("capture");
        }}
        className={ROW_CLASS}
      >
        <StatusDot state={readiness.hotkeysActive ? "ready" : "off"} size="sm" />
        <span className="w-[64px] shrink-0 text-text-muted">Hotkey</span>
        <span className="min-w-0 flex-1 truncate text-text">
          {readiness.hotkeysActive ? formatAccelerator(settings.pttAccelerator) : "Off"}
        </span>
      </button>

      <button type="button" onClick={openEngine} className={ROW_CLASS}>
        <StatusDot state={engineReady ? "ready" : "warning"} size="sm" />
        <span className="w-[64px] shrink-0 text-text-muted">Voice engine</span>
        <span className="min-w-0 flex-1 truncate text-text">{engineValue}</span>
        <Badge tone={isCloud ? "warning" : "neutral"}>
          {isCloud ? "Cloud" : isLocal ? "Local" : "Test"}
        </Badge>
      </button>

      <button
        type="button"
        onClick={() => {
          setRoute("settings");
        }}
        className="flex cursor-pointer items-center gap-1 self-start text-xs text-text-muted transition-colors duration-hover hover:text-text"
      >
        More
        <Icon icon="ph:caret-right" className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
