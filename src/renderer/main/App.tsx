import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Rail } from "./components/Rail";
import { TitleBar } from "./components/TitleBar";
import { CommandPalette } from "./components/CommandPalette";
import { FirstRun } from "./components/FirstRun";
import { useMainStore } from "./store/use-main-store";
import { DictateView } from "./views/DictateView";
import { HistoryView } from "./views/HistoryView";
import { ModelsView } from "./views/ModelsView";
import { SettingsView } from "./views/SettingsView";

export function App(): JSX.Element {
  const route = useMainStore((state) => state.route);
  const setRoute = useMainStore((state) => state.setRoute);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showFirstRun, setShowFirstRun] = useState(true);

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

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Rail route={route} onSelect={setRoute} />
        <main className="min-h-0 flex-1 overflow-hidden bg-bg" data-selectable>
          {route === "dictate" && <DictateView />}
          {route === "history" && <HistoryView />}
          {route === "models" && <ModelsView />}
          {route === "settings" && <SettingsView />}
        </main>
      </div>
      {/* The first-run banner is fixed to the bottom, so it would cover the
          last controls of a scrolling view. Reserve the space it occupies. */}
      {showFirstRun && <div aria-hidden="true" className="h-[168px] shrink-0" />}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={setRoute}
      />
      {showFirstRun && (
        <FirstRun
          onNavigate={setRoute}
          onDismissed={() => {
            setShowFirstRun(false);
          }}
        />
      )}
    </div>
  );
}
