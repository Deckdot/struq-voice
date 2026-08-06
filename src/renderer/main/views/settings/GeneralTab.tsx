import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { Button, Select, SettingsGroup, SettingsRow, Switch } from "../../components/ui";
import { useTranslation } from "../../lib/useTranslation";
import { formatLocaleLabel, LOCALE_META, resolveLocale, SUPPORTED_LOCALES } from "../../../../shared/i18n";

/**
 * The General settings tab: when Struq Voice starts, language preferences, and updates.
 */
export interface GeneralTabProps {
  readonly api: MainWindowApi;
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
  readonly updateState: { phase: string };
  readonly currentVersion: string;
}

export function GeneralTab({
  api,
  settings,
  update,
  updateState,
  currentVersion
}: GeneralTabProps): JSX.Element {
  const { t } = useTranslation();

  const resolvedSystemLocale = resolveLocale(navigator.languages);
  const resolvedSystemMeta = LOCALE_META[resolvedSystemLocale];

  const updateMessage: string = (() => {
    switch (updateState.phase) {
      case "checking":
        return t("settings.general.updates.checking");
      case "downloading":
        return t("settings.general.updates.downloading");
      case "ready":
        return t("settings.general.updates.ready", { version: currentVersion });
      case "refused":
        return t("settings.general.updates.refused");
      case "error":
        return t("settings.general.updates.error");
      case "idle":
      default:
        return t("settings.general.updates.upToDate");
    }
  })();

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title={t("settings.general.system.title")}
      >
        <SettingsRow
          label={t("settings.general.autostart.label")}
          hint={t("settings.general.autostart.hint")}
          control={
            <Switch
              checked={settings.autostart}
              onChange={(autostart) => {
                update({ autostart });
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
                {t("settings.appearance.language.system", { resolved: formatLocaleLabel(resolvedSystemMeta) })}
              </option>
              {SUPPORTED_LOCALES.map((code) => {
                const meta = LOCALE_META[code];
                return (
                  <option key={code} value={code}>
                    {formatLocaleLabel(meta)}
                  </option>
                );
              })}
            </Select>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.general.updates.title")}
        {...(currentVersion.length > 0 ? { description: `v${currentVersion}` } : {})}
      >
        <SettingsRow
          label={t("settings.general.updates.statusLabel")}
          hint={updateMessage}
          control={
            updateState.phase === "ready" ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  void api.updates.install();
                }}
              >
                {t("settings.general.updates.installBtn")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={updateState.phase === "checking"}
                onClick={() => {
                  void api.updates.check();
                }}
              >
                <Icon
                  icon="ph:arrow-clockwise"
                  className={`h-3.5 w-3.5 ${updateState.phase === "checking" ? "motion-safe:animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {t("settings.general.updates.checkBtn")}
              </Button>
            )
          }
        />
        {updateState.phase === "refused" && (
          <SettingsRow
            label={t("settings.general.updates.whyHappened")}
            hint={t("settings.general.updates.refusedHint")}
            control={
              <Icon icon="ph:warning-circle" className="h-4 w-4 text-warning" aria-hidden="true" />
            }
          />
        )}
      </SettingsGroup>
    </div>
  );
}
