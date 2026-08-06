import type { JSX } from "react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { Button, SegmentedControl, Select, SettingsGroup, SettingsRow } from "../../components/ui";
import { useTranslation } from "../../lib/useTranslation";
import { LOCALE_META, resolveLocale, SUPPORTED_LOCALES } from "../../../../shared/i18n";

/**
 * The Appearance settings tab: theme, interface language and the floating capture panel.
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
  const { t } = useTranslation();
  const theme: Theme = settings.theme;

  const resolvedSystemLocale = resolveLocale(navigator.languages);
  const resolvedSystemMeta = LOCALE_META[resolvedSystemLocale];

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t("settings.appearance.theme.title")}>
        <SettingsRow
          label={t("settings.appearance.theme.label")}
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

      <SettingsGroup title={t("settings.appearance.language.title")}>
        <SettingsRow
          label={t("settings.appearance.language.label")}
          hint="Change the display language for menus, settings, and notifications."
          control={
            <Select
              value={settings.locale}
              onChange={(e) => {
                update({ locale: e.target.value });
              }}
            >
              <option value="system">
                {t("settings.appearance.language.system", { resolved: resolvedSystemMeta.endonym })}
              </option>
              {SUPPORTED_LOCALES.map((code) => {
                const meta = LOCALE_META[code];
                const betaTag = meta.reviewed ? "" : " (Beta)";
                return (
                  <option key={code} value={code}>
                    {meta.endonym}{betaTag}
                  </option>
                );
              })}
            </Select>
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
