import type { JSX } from "react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { Button, Card, SegmentedControl, SettingsGroup, SettingsRow } from "../../components/ui";

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
    <div className="flex flex-col gap-8">
      <SettingsGroup
        title="Theme"
        description="Struq Voice follows your choice. Follow Windows means it tracks the setting in the Windows Settings app."
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
        description="The small window that appears while you dictate. You can drag it anywhere; the position is remembered."
      >
        <SettingsRow
          label="Reset panel position"
          hint="If the panel has wandered off screen or onto a display you no longer use, this brings it back to the bottom center."
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

      <SettingsGroup
        title="Motion"
        description="Struq Voice follows the Windows reduced motion setting automatically. No toggle needed here."
      >
        <Card>
          <p className="text-sm text-text-secondary">
            When Windows is set to reduce motion, animations become simpler and shorter. The
            capture pill still updates while you speak, just without the rise and settle.
          </p>
        </Card>
      </SettingsGroup>
    </div>
  );
}
