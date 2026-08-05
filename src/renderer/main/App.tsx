import type { JSX } from "react";
import { Rail } from "./components/Rail";
import { TitleBar } from "./components/TitleBar";
import { useMainStore } from "./store/use-main-store";
import { DictateView } from "./views/DictateView";
import { HistoryView } from "./views/HistoryView";
import { ModelsView } from "./views/ModelsView";
import { SettingsView } from "./views/SettingsView";

export function App(): JSX.Element {
  const route = useMainStore((state) => state.route);
  const setRoute = useMainStore((state) => state.setRoute);

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
    </div>
  );
}
