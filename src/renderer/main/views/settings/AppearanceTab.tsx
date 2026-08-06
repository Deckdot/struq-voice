import type { JSX } from "react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { Button, SegmentedControl, SettingsGroup, SettingsRow } from "../../components/ui";

/**
 * The Appearance settings tab: theme and the floating capture panel.
 */
export interface AppearanceTabProps {
  readonly api: MainWindowApi;
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
}

type Theme = "system" | "light" | "dark";

const THEME_OPTIONS: readonly { value: Theme; label: string; icon: string }[] = [
  { value: "system", label: "Follow Windows", icon: "ph:circle-half" },
  { value: "light", label: "Light", icon: "ph:sun" },
  { value: "dark", label: "Dark", icon: "ph:moon" }
];

export function AppearanceTab({ settings, update }: AppearanceTabProps): JSX.Element {
  const theme: Theme = settings.theme;
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title="Theme"
      >
        <SettingsRow
          label="Color theme"
          hint="Affects the whole window, including menus and dialogs."
          control={
            <SegmentedControl<Theme>
              options={THEME_OPTIONS}
              value={theme}
              onChange={(next) => {
                update({ theme: next });
              }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Capture panel"
        description="Drag it anywhere. The position is remembered."
      >
        <SettingsRow
          label="Reset panel position"
          hint="Brings it back to the bottom centre."
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                update({ overlayPosition: null });
              }}
            >
              Reset position
            </Button>
          }
        />
      </SettingsGroup>

    </div>
  );
}
