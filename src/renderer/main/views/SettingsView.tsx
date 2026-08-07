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
import { MeetingsTab } from "./settings/MeetingsTab";

import { useTranslation } from "../lib/useTranslation";

/**
 * The Settings shell. Seven categories, each in its own file under
 * ./settings/. The active category is driven by a `category` field in the
 * route-aware state: the StatusCluster and the command palette both emit
 * a `struq:open-settings-category` event that lands here.
 */

type Category =
  | "general"
  | "capture"
  | "transcription"
  | "delivery"
  | "text"
  | "appearance"
  | "meetings";

interface CategoryMeta {
  readonly id: Category;
  readonly label: string;
  readonly icon: string;
}

const isCategory = (value: string): value is Category =>
  value === "general" ||
  value === "capture" ||
  value === "transcription" ||
  value === "delivery" ||
  value === "text" ||
  value === "appearance" ||
  value === "meetings";

export function SettingsView(): JSX.Element {
  const { t } = useTranslation();
  const api = window.struqVoice as MainWindowApi;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [category, setCategory] = useState<Category>("general");
  const [updateState, setUpdateState] = useState<UpdateState>(INITIAL_UPDATE_STATE);
  const [currentVersion, setCurrentVersion] = useState("");
  const [devices, setDevices] = useState<readonly RecorderDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);

  const categories: readonly CategoryMeta[] = [
    { id: "general", label: t("settings.category.general"), icon: "ph:sliders-horizontal" },
    { id: "capture", label: t("settings.category.capture"), icon: "ph:microphone" },
    { id: "transcription", label: t("settings.category.transcription"), icon: "ph:wave-sine" },
    { id: "delivery", label: t("settings.category.delivery"), icon: "ph:clipboard-text" },
    { id: "text", label: t("settings.category.text"), icon: "ph:text-t" },
    { id: "appearance", label: t("settings.category.appearance"), icon: "ph:circle-half" },
    { id: "meetings", label: t("settings.category.meetings"), icon: "ph:users-three" }
  ];

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
          items={categories}
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
            {category === "meetings" && <MeetingsTab settings={settings} update={update} />}
        </div>
      </div>
    </div>
  );
}
