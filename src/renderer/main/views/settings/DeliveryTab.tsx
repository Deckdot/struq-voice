import type { JSX } from "react";
import type { Settings } from "../../../../shared/settings";
import { NumberInput, SettingsGroup, SettingsNote, SettingsRow, Switch } from "../../components/ui";
import { useTranslation } from "../../lib/useTranslation";

/**
 * The Delivery settings tab: how the transcript reaches the window the
 * user was working in.
 */
export interface DeliveryTabProps {
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
}

export function DeliveryTab({ settings, update }: DeliveryTabProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t("settings.delivery.clipboard.title")}>
        <SettingsRow
          label={t("settings.delivery.automaticPaste.label")}
          hint={t("settings.delivery.automaticPaste.hint")}
          control={
            <Switch
              checked={settings.automaticPaste}
              onChange={(automaticPaste) => {
                update({ automaticPaste });
              }}
            />
          }
        />
        <SettingsRow
          label={t("settings.delivery.restore.label")}
          hint={t("settings.delivery.restore.hint")}
          control={
            <Switch
              checked={settings.restoreClipboard}
              disabled={!settings.automaticPaste}
              onChange={(restoreClipboard) => {
                update({ restoreClipboard });
              }}
            />
          }
        />
        <SettingsRow
          label={t("settings.delivery.delay.label")}
          hint={t("settings.delivery.delay.hint")}
          control={
            <div className="w-32">
              <NumberInput
                value={settings.restoreClipboardDelayMs}
                min={0}
                max={5000}
                step={50}
                unit="ms"
                disabled={!settings.automaticPaste || !settings.restoreClipboard}
                onChange={(value) => {
                  update({ restoreClipboardDelayMs: value });
                }}
              />
            </div>
          }
        />
        <SettingsRow
          label={t("settings.delivery.pressEnter.label")}
          hint={t("settings.delivery.pressEnter.hint")}
          control={
            <Switch
              checked={settings.pressEnterAfterPaste}
              disabled={!settings.automaticPaste}
              onChange={(pressEnterAfterPaste) => {
                update({ pressEnterAfterPaste });
              }}
            />
          }
        />
        {settings.automaticPaste && (
          <SettingsNote icon="ph:info">
            {t("settings.delivery.pasteFallback")}
          </SettingsNote>
        )}
      </SettingsGroup>
    </div>
  );
}
