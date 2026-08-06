import type { JSX } from "react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { useMainStore } from "../../store/use-main-store";
import { Button, SettingsGroup, SettingsRow, Switch } from "../../components/ui";
import { useTranslation } from "../../lib/useTranslation";

/**
 * The Text settings tab: the small cleanups applied to every transcript,
 * and a link to the standalone Dictionary view.
 */
export interface TextTabProps {
  readonly api: MainWindowApi;
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
}

export function TextTab({ settings, update }: TextTabProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title={t("settings.text.post.title")}
        description={t("settings.text.post.subtitle")}
      >
        <SettingsRow
          label={t("settings.text.fillers.label")}
          hint={t("settings.text.fillers.hint")}
          control={
            <Switch
              checked={settings.post.removeFillers}
              onChange={(removeFillers) => {
                update({ post: { ...settings.post, removeFillers } });
              }}
            />
          }
        />
        <SettingsRow
          label={t("settings.text.punctuation.label")}
          control={
            <Switch
              checked={settings.post.addTrailingPunctuation}
              onChange={(addTrailingPunctuation) => {
                update({ post: { ...settings.post, addTrailingPunctuation } });
              }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.text.dictionary.title")}>
        <SettingsRow
          label={t("settings.text.dictionary.wordsLabel")}
          hint={
            settings.post.dictionary.length === 0
              ? t("settings.text.dictionary.emptyHint")
              : t("settings.text.dictionary.rulesHint", { count: settings.post.dictionary.length })
          }
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                useMainStore.getState().setRoute("dictionary");
              }}
            >
              {t("settings.text.dictionary.manageBtn")}
            </Button>
          }
        />
      </SettingsGroup>
    </div>
  );
}
