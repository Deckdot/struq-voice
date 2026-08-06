import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { MainWindowApi } from "../../../shared/api";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import type { UpdateState } from "../../../shared/updates";
import { INITIAL_UPDATE_STATE } from "../../../shared/updates";
import type { RecorderDevice } from "../../../shared/ipc";
import { Tabs } from "../components/ui";
import { GeneralTab } from "./settings/GeneralTab";
import { CaptureTab } from "./settings/CaptureTab";
import { TranscriptionTab } from "./settings/TranscriptionTab";
import { DeliveryTab } from "./settings/DeliveryTab";
import { TextTab } from "./settings/TextTab";
import { AppearanceTab } from "./settings/AppearanceTab";

/**
 * The Settings shell. Six categories, each in its own file under
 * ./settings/. The active category is driven by a `category` field in the
 * route-aware state: the StatusCluster and the command palette both emit
 * a `struq:open-settings-category` event that lands here.
 */

type Category = "general" | "capture" | "transcription" | "delivery" | "text" | "appearance";

interface CategoryMeta {
  readonly id: Category;
  readonly label: string;
  readonly icon: string;
}

const CATEGORIES: readonly CategoryMeta[] = [
  { id: "general", label: "General", icon: "ph:sliders-horizontal" },
  { id: "capture", label: "Capture", icon: "ph:microphone" },
  { id: "transcription", label: "Transcription", icon: "ph:wave-sine" },
  { id: "delivery", label: "Delivery", icon: "ph:clipboard-text" },
  { id: "text", label: "Text", icon: "ph:text-t" },
  { id: "appearance", label: "Appearance", icon: "ph:circle-half" }
];

const isCategory = (value: string): value is Category =>
  value === "general" || value === "capture" || value === "transcription" || value === "delivery" || value === "text" || value === "appearance";

export function SettingsView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [category, setCategory] = useState<Category>("general");
  const [updateState, setUpdateState] = useState<UpdateState>(INITIAL_UPDATE_STATE);
  const [currentVersion, setCurrentVersion] = useState("");
  const [devices, setDevices] = useState<readonly RecorderDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);

  useEffect(() => {
    void api.settings.get().then(({ settings: loaded }) => {
      setSettings(loaded);
    });
    return api.settings.onChange((changed) => {
      setSettings(changed);
    });
  }, [api]);

  useEffect(() => {
    void api.updates.get().then(({ state, currentVersion: version }) => {
      setUpdateState(state);
      setCurrentVersion(version);
    });
    return api.updates.onChange((state) => {
      setUpdateState(state);
    });
  }, [api]);

  useEffect(() => {
    void api.devices.list().then(({ devices: list, currentDeviceId: id }) => {
      setDevices(list);
      setCurrentDeviceId(id);
    });
  }, [api]);

  useEffect(() => {
    const onCategory = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail;
      if (isCategory(detail)) setCategory(detail);
    };
    window.addEventListener("struq:open-settings-category", onCategory);
    return () => {
      window.removeEventListener("struq:open-settings-category", onCategory);
    };
  }, []);

  const update = (patch: Partial<Settings>): void => {
    void api.settings.update(patch).then(({ settings: updated }) => {
      setSettings(updated);
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-bg [scrollbar-gutter:stable]" data-selectable>
      <div className="mx-auto w-full max-w-[920px] px-6 py-4">
        <Tabs
          items={CATEGORIES}
          active={category}
          onSelect={(next) => {
            if (isCategory(next)) setCategory(next);
          }}
          className="border-b border-border"
        />

        <div className="mx-auto mt-5 w-full max-w-[800px]" role="tabpanel">
            {category === "general" && (
              <GeneralTab
                api={api}
                settings={settings}
                update={update}
                updateState={updateState}
                currentVersion={currentVersion}
              />
            )}
            {category === "capture" && (
              <CaptureTab
                api={api}
                settings={settings}
                update={update}
                devices={devices}
                currentDeviceId={currentDeviceId}
              />
            )}
            {category === "transcription" && (
              <TranscriptionTab api={api} settings={settings} update={update} />
            )}
            {category === "delivery" && <DeliveryTab settings={settings} update={update} />}
            {category === "text" && <TextTab api={api} settings={settings} update={update} />}
            {category === "appearance" && <AppearanceTab api={api} settings={settings} update={update} />}
        </div>
      </div>
    </div>
  );
}
