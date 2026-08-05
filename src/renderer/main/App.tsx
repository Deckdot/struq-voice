import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Rail } from "./components/Rail";
import { TitleBar } from "./components/TitleBar";
import { CommandPalette } from "./components/CommandPalette";
import { UpdateDialog } from "./components/UpdateDialog";
import { Onboarding } from "./onboarding/Onboarding";
import { useMainStore } from "./store/use-main-store";
import { DictateView } from "./views/DictateView";
import { HistoryView } from "./views/HistoryView";
import { ModelsView } from "./views/ModelsView";
import { SettingsView } from "./views/SettingsView";
import type { MainWindowApi } from "../../shared/api";
import type { Settings } from "../../shared/settings";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import { MOCK_ENGINE_ID } from "../../shared/engines";
import { shouldRunOnboarding } from "../../shared/settings";

export function App(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const route = useMainStore((state) => state.route);
  const setRoute = useMainStore((state) => state.setRoute);
  const capture = useMainStore((state) => state.capture);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [onboarding, setOnboarding] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Whether onboarding runs is decided once, from the settings main persists.
  // Re-deciding on every settings change would tear the flow down the moment
  // a step wrote a hotkey.
  useEffect(() => {
    let cancelled = false;
    void api.settings.get().then(({ settings: loaded }) => {
      if (cancelled) return;
      setSettings(loaded);
      setOnboarding(shouldRunOnboarding(loaded, MOCK_ENGINE_ID));
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    return api.settings.onChange(setSettings);
  }, [api]);

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <TitleBar />
      {onboarding ? (
        <Onboarding
          settings={settings ?? DEFAULT_SETTINGS}
          capture={capture}
          onFinished={() => {
            setOnboarding(false);
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <Rail route={route} onSelect={setRoute} />
          <main className="min-h-0 flex-1 overflow-hidden bg-bg" data-selectable>
            {route === "dictate" && <DictateView />}
            {route === "history" && <HistoryView />}
            {route === "models" && <ModelsView />}
            {route === "settings" && <SettingsView />}
          </main>
        </div>
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={setRoute}
      />
      {/* Not during onboarding: a first run has nothing to update from. */}
      {!onboarding && <UpdateDialog api={api} />}
    </div>
  );
}
