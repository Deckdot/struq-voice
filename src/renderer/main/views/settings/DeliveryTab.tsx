import type { JSX } from "react";
import type { Settings } from "../../../../shared/settings";
import { Disclosure, NumberInput, SettingsGroup, SettingsNote, SettingsRow, Switch } from "../../components/ui";

/**
 * The Delivery settings tab: how the transcript reaches the window the
 * user was working in.
 */
export interface DeliveryTabProps {
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
}

export function DeliveryTab({ settings, update }: DeliveryTabProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title="Clipboard">
        <SettingsRow
          label="Restore previous clipboard"
          hint="Puts back what you had copied before the paste."
          control={
            <Switch
              checked={settings.restoreClipboard}
              onChange={(restoreClipboard) => {
                update({ restoreClipboard });
              }}
            />
          }
        />
        <div className="px-4 py-3">
          <Disclosure label="Advanced">
            <SettingsRow
              label="Restore delay"
              hint="Increase if a slow app is still reading the clipboard."
              control={
                <div className="w-32">
                  <NumberInput
                    value={settings.restoreClipboardDelayMs}
                    min={0}
                    max={5000}
                    step={50}
                    unit="ms"
                    onChange={(value) => {
                      update({ restoreClipboardDelayMs: value });
                    }}
                  />
                </div>
              }
            />
          </Disclosure>
        </div>
        <SettingsNote icon="ph:info">
          If a paste ever fails, the text is still on your clipboard. Press Ctrl+V yourself.
        </SettingsNote>
      </SettingsGroup>
    </div>
  );
}
