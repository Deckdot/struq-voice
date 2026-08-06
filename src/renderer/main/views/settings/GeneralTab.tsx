import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { Button, SettingsGroup, SettingsNote, SettingsRow, Switch } from "../../components/ui";

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
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title="Startup"
      >
        <SettingsRow
          label="Start with Windows"
          hint="Opens in the tray, ready from login."
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
          hint="Quit from the tray icon."
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
            hint="The download failed its signature check and was discarded."
            control={
              <Icon icon="ph:warning-circle" className="h-4 w-4 text-warning" aria-hidden="true" />
            }
          />
        )}
      </SettingsGroup>

      <SettingsGroup title="This computer">
        <SettingsNote icon="ph:monitor">
          Your processor, memory and graphics card decide which model is recommended. After a
          hardware upgrade, check the Models tab again.
        </SettingsNote>
      </SettingsGroup>
    </div>
  );
}
