import type { JSX } from "react";
import type { Settings } from "../../../../shared/settings";
import { Card, Disclosure, NumberInput, SettingsGroup, SettingsRow, Switch } from "../../components/ui";

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
    <div className="flex flex-col gap-8">
      <SettingsGroup
        title="How pasting works"
        description="A short explanation of what happens between 'finished transcribing' and 'text on screen'."
      >
        <Card>
          <ol className="ml-5 list-decimal space-y-1 text-sm text-text-secondary">
            <li>Struq Voice copies the finished text to the clipboard.</li>
            <li>It sends a paste command (Ctrl+V) so the text lands at your cursor.</li>
            <li>
              If the app you are in is Struq Voice itself, the text is inserted directly, no paste
              command needed.
            </li>
          </ol>
        </Card>
      </SettingsGroup>

      <SettingsGroup
        title="Clipboard"
        description="Struq Voice uses the clipboard to deliver text. You can ask it to put whatever was there back afterwards."
      >
        <SettingsRow
          label="Restore what was on the clipboard"
          hint="After a paste, Struq Voice puts your previous clipboard contents back. Useful when you often copy from one place and paste in another."
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
              hint="How long to wait before putting the old clipboard contents back. Increase this if a slow app is still reading the clipboard when Struq Voice tries to restore."
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
      </SettingsGroup>

      <SettingsGroup
        title="If the paste fails"
        description="Sometimes an application does not accept the simulated paste. Here is what to do."
      >
        <Card>
          <p className="text-sm text-text-secondary">
            The text is on your clipboard. Open the destination field and press
            <span className="mx-1 font-mono">Ctrl + V</span>
            yourself, or right-click and choose Paste. Struq Voice will tell you when this
            happened by changing the capture pill to red and showing the text.
          </p>
        </Card>
      </SettingsGroup>
    </div>
  );
}
