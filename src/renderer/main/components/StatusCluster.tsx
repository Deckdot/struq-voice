import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import { MOCK_ENGINE_ID, engineOption } from "../../../shared/engines";
import type { ModelStatus } from "../../../shared/models";
import { useMainStore } from "../store/use-main-store";

const openSettingsCategory = (category: string): void => {
  useMainStore.getState().setRoute("settings");
  window.dispatchEvent(new CustomEvent("struq:open-settings-category", { detail: category }));
};

interface Fault {
  readonly label: string;
  readonly open: () => void;
}

/**
 * The fault footer at the bottom of the rail. When everything works it
 * renders nothing at all: a permanent green "Ready" is a status line
 * reporting the absence of news, and it trains the eye to ignore the exact
 * corner that needs to shout when something does break.
 *
 * It deliberately never shows the current engine. That is a decision made
 * once during setup, and a permanent "Local / Parakeet" badge spends the
 * quietest corner of the window on a value that never changes. Settings and
 * the command palette both still show it.
 */
export function StatusCluster(): JSX.Element | null {
  const api = window.struqVoice as MainWindowApi;
  const readiness = useMainStore((state) => state.readiness);
  const setRoute = useMainStore((state) => state.setRoute);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
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

  // First fault wins. Listing three simultaneous problems helps nobody: the
  // microphone is the prerequisite for the rest anyway.
  const fault: Fault | null = !readiness.microphone.live
    ? {
        label: "Microphone off",
        open: () => {
          openSettingsCategory("capture");
        }
      }
    : !readiness.hotkeysActive
      ? {
          label: "Shortcuts off",
          open: () => {
            openSettingsCategory("capture");
          }
        }
      : !engineReady
        ? {
            label:
              settings.engine.primary === MOCK_ENGINE_ID
                ? "Practice mode"
                : isCloud
                  ? "API key needed"
                  : "Model not downloaded",
            open: () => {
              if (isLocal && settings.engine.primary !== MOCK_ENGINE_ID) {
                setRoute("models");
                return;
              }
              openSettingsCategory("transcription");
            }
          }
        : null;

  if (fault === null) return null;

  return (
    <div className="border-t border-border p-2">
      <button
        type="button"
        onClick={fault.open}
        className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-xs text-warning transition-colors duration-hover hover:bg-surface-hover"
      >
        <Icon icon="ph:warning" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{fault.label}</span>
        <Icon icon="ph:caret-right" className="h-3 w-3 shrink-0" aria-hidden="true" />
      </button>
    </div>
  );
}
