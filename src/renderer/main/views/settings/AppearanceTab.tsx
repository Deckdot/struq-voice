import type { JSX } from "react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { Button, SegmentedControl, SettingsGroup, SettingsRow } from "../../components/ui";
import { useTranslation } from "../../lib/useTranslation";

/**
 * The Appearance settings tab: theme and the floating capture panel position.
 */
export interface AppearanceTabProps {
  readonly api: MainWindowApi;
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
}

type Theme = "system" | "light" | "dark";

export function AppearanceTab({ settings, update }: AppearanceTabProps): JSX.Element {
  const { t } = useTranslation();
  const theme: Theme = settings.theme;

  const themeOptions: readonly { value: Theme; label: string; icon: string }[] = [
    { value: "system", label: t("settings.appearance.theme.system"), icon: "ph:circle-half" },
    { value: "light", label: t("settings.appearance.theme.light"), icon: "ph:sun" },
    { value: "dark", label: t("settings.appearance.theme.dark"), icon: "ph:moon" }
  ];

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t("settings.appearance.theme.title")}>
        <SettingsRow
          label={t("settings.appearance.theme.label")}
          hint={t("settings.appearance.theme.hint")}
          control={
            <SegmentedControl<Theme>
              options={themeOptions}
              value={theme}
              onChange={(next) => {
                update({ theme: next });
              }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.appearance.panel.title")}
        description={t("settings.appearance.panel.subtitle")}
      >
        <SettingsRow
          label={t("settings.appearance.panel.resetLabel")}
          hint={t("settings.appearance.panel.resetHint")}
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                update({ overlayPosition: null });
              }}
            >
              {t("settings.appearance.panel.resetBtn")}
            </Button>
          }
        />
      </SettingsGroup>
    </div>
  );
}
