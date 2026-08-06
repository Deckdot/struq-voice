import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { Button, Card, SettingsGroup, SettingsRow, Switch } from "../../components/ui";

/**
 * The General settings tab: when Struq Voice starts, what happens when you
 * close the window, and whether to check for updates.
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
  const updateMessage: string = (() => {
    switch (updateState.phase) {
      case "checking":
        return "Checking for updates...";
      case "downloading":
        return "Downloading the update...";
      case "ready":
        return "A new version is ready to install.";
      case "refused":
        return "The update was rejected. The download did not match the release signature.";
      case "error":
        return "Could not check for updates.";
      case "idle":
      default:
        return "Up to date.";
    }
  })();

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup
        title="Startup"
        description="What Struq Voice does when Windows starts and when you close the window."
      >
        <SettingsRow
          label="Start with Windows"
          hint="Opens in the system tray. Your key works from the moment you log in."
          control={
            <Switch
              checked={settings.autostart}
              onChange={(autostart) => {
                update({ autostart });
              }}
            />
          }
        />
        <SettingsRow
          label="Close button"
          hint="Closing the window keeps Struq Voice running in the tray. Use the tray icon to quit."
          control={<span className="text-2xs text-text-muted">Always hides to tray</span>}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Updates"
        description={`Struq Voice ${currentVersion.length > 0 ? currentVersion : "is the latest version"}.`}
      >
        <SettingsRow
          label="Update status"
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
                Restart and install
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
                Check for updates
              </Button>
            )
          }
        />
        {updateState.phase === "refused" && (
          <SettingsRow
            label="Why this happened"
            hint="Nothing was installed. The download did not match the release signature, so it was discarded to keep your computer safe."
            control={
              <Icon icon="ph:warning-circle" className="h-4 w-4 text-warning" aria-hidden="true" />
            }
          />
        )}
      </SettingsGroup>

      <SettingsGroup
        title="This computer"
        description="A short summary of the machine Struq Voice detected. Used to pick a voice helper that fits."
      >
        <Card>
          <div className="flex items-start gap-3">
            <Icon icon="ph:monitor" className="mt-0.5 h-4 w-4 text-text-muted" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-text">Hardware profile</p>
              <p className="mt-1 text-sm text-text-muted">
                Struq Voice used the processor, memory and graphics card it found on this machine
                to recommend a model. If you upgrade any of those, run a download again from the
                Models tab.
              </p>
            </div>
          </div>
        </Card>
      </SettingsGroup>
    </div>
  );
}
