import type { JSX } from "react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { useMainStore } from "../../store/use-main-store";
import { Button, SettingsGroup, SettingsRow, Switch } from "../../components/ui";

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
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title="Cleanups"
        description="Applied to every transcript before it lands."
      >
        <SettingsRow
          label="Remove filler words"
          hint='Strips out the "um" and "uh" sounds that often sneak in. Turn off if you would rather keep them.'
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
          label="Add a period at the end"
          hint="Adds a period when one is missing."
          control={
            <Switch
              checked={settings.post.addTrailingPunctuation}
              onChange={(addTrailingPunctuation) => {
                update({ post: { ...settings.post, addTrailingPunctuation } });
              }}
            />
          }
        />
        <SettingsRow
          label="Whitespace"
          hint="Always on. Trims and collapses extra spaces."
          control={<span className="text-2xs text-text-muted">Always on</span>}
        />
      </SettingsGroup>

      <SettingsGroup title="Dictionary">
        <SettingsRow
          label="Words to fix"
          hint={
            settings.post.dictionary.length === 0
              ? "Teach Struq Voice the words it keeps getting wrong."
              : `${String(settings.post.dictionary.length)} rules applied to every transcript.`
          }
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                useMainStore.getState().setRoute("dictionary");
              }}
            >
              Open Dictionary
            </Button>
          }
        />
      </SettingsGroup>
    </div>
  );
}
