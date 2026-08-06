import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import type { UpdateState } from "../../../shared/updates";
import { INITIAL_UPDATE_STATE } from "../../../shared/updates";
import type { RecorderDevice } from "../../../shared/ipc";
import { SettingsGroup } from "../components/ui";
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
  readonly hint: string;
}

const CATEGORIES: readonly CategoryMeta[] = [
  { id: "general", label: "General", icon: "ph:sliders-horizontal", hint: "Startup, updates, this computer." },
  { id: "capture", label: "Capture", icon: "ph:microphone", hint: "Keys, microphone, sounds, timing." },
  { id: "transcription", label: "Transcription", icon: "ph:wave-sine", hint: "Voice service, backup, keys, models." },
  { id: "delivery", label: "Delivery", icon: "ph:clipboard-text", hint: "How the text reaches your app." },
  { id: "text", label: "Text", icon: "ph:text-t", hint: "Cleanups and the words Struq Voice fixes." },
  { id: "appearance", label: "Appearance", icon: "ph:circle-half", hint: "Theme and the capture panel." }
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
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="border-b border-border px-8 py-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Settings</h1>
        <p className="mt-1 text-sm text-text-muted">
          Changes apply immediately. Nothing here needs a restart.
        </p>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings categories"
          className="flex w-[180px] shrink-0 flex-col gap-0.5 border-r border-border bg-bg-sunken p-3"
        >
          {CATEGORIES.map((entry) => {
            const active = entry.id === category;
            return (
              <button
                key={entry.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setCategory(entry.id);
                }}
                className={`flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-hover ${
                  active
                    ? "bg-surface text-text"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text"
                }`}
              >
                <Icon icon={entry.icon} className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{entry.label}</span>
                  <span className="mt-0.5 block truncate text-2xs text-text-muted">{entry.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6" data-selectable>
          <div className="mx-auto w-full max-w-[760px]">
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

            <div className="mt-10">
              <SettingsGroup
                title="Need to start over?"
                description="These are the only settings that may not be obvious from their names. Reach out if anything is unclear."
              >
                <p className="px-4 py-3 text-sm text-text-secondary">
                  Struq Voice saves settings as you change them. There is no Save button because
                  there is nothing to save. The only thing that gets reset by reinstalling is the
                  Whisper helper, which Struq Voice will fetch again the next time you need it.
                </p>
              </SettingsGroup>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
