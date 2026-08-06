import type { JSX } from "react";
import type { MainWindowApi } from "../../../../shared/api";
import type { RecorderDevice } from "../../../../shared/ipc";
import type { Settings } from "../../../../shared/settings";
import {
  Disclosure,
  HotkeyRecorder,
  NumberInput,
  Select,
  SettingsGroup,
  SettingsRow,
  Slider,
  Switch
} from "../../components/ui";

/**
 * The Capture settings tab: the keys, the microphone, the sounds Struq
 * Voice plays, the optional live transcript. Things that affect what
 * happens between "press" and "paste".
 */
export interface CaptureTabProps {
  readonly api: MainWindowApi;
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
  readonly devices: readonly RecorderDevice[];
  readonly currentDeviceId: string | null;
}

export function CaptureTab({
  api,
  settings,
  update,
  devices,
  currentDeviceId
}: CaptureTabProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title="Keys"
      >
        <SettingsRow
          label="Hold to record"
          hint="Hold, speak, release."
          control={
            <HotkeyRecorder
              label="hold to record key"
              accelerator={settings.pttAccelerator}
              size="md"
              onChange={(pttAccelerator) => {
                update({ pttAccelerator });
              }}
            />
          }
        />
        <SettingsRow
          label="Press to toggle"
          hint="Press once to start, once to stop."
          control={
            <HotkeyRecorder
              label="press to toggle key"
              accelerator={settings.toggleAccelerator}
              onChange={(toggleAccelerator) => {
                update({ toggleAccelerator });
              }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Microphone"
      >
        <SettingsRow
          label="Active microphone"
          hint="An empty list means Windows has not granted microphone permission."
          control={
            <div className="w-72">
              <Select
                aria-label="Microphone device"
                value={currentDeviceId ?? ""}
                onChange={(event) => {
                  const deviceId = event.target.value;
                  api.devices.setDevice(deviceId);
                }}
                disabled={devices.length === 0}
              >
                {devices.length === 0 && <option value="">No microphones found</option>}
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Sounds"
        description="Confirms the microphone is live without looking."
      >
        <SettingsRow
          label="Play capture sounds"
          hint="A chime when a capture starts and ends."
          control={
            <Switch
              checked={settings.captureSounds}
              onChange={(captureSounds) => {
                update({ captureSounds });
              }}
            />
          }
        />
        <SettingsRow
          label="Volume"
          hint="No effect when sounds are off."
          control={
            <div className="w-48">
              <Slider
                value={Math.round(settings.captureSoundVolume * 100)}
                min={0}
                max={100}
                step={5}
                unit="%"
                onChange={(percent) => {
                  update({ captureSoundVolume: percent / 100 });
                }}
                disabled={!settings.captureSounds}
              />
            </div>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Live transcript"
        description="Costs extra processing while you speak."
      >
        <SettingsRow
          label="Show words as I speak"
          hint="Competes with the final pass on slower machines."
          control={
            <Switch
              checked={settings.liveTranscription}
              onChange={(liveTranscription) => {
                update({ liveTranscription });
              }}
            />
          }
        />
        <SettingsRow
          label="How often to refresh"
          hint="Lower numbers are smoother but use more processor time."
          control={
            <div className="w-32">
              <NumberInput
                value={settings.liveTranscriptionIntervalMs}
                min={400}
                max={10000}
                step={100}
                unit="ms"
                disabled={!settings.liveTranscription}
                onChange={(value) => {
                  update({ liveTranscriptionIntervalMs: value });
                }}
              />
            </div>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Capture timing"
        description="The defaults suit most people."
      >
        <div className="px-4 py-3">
          <Disclosure label="Advanced capture timing">
            <div className="flex flex-col gap-4">
              <SettingsRow
                label="Shortest capture"
                hint="Shorter captures are discarded."
                control={
                  <div className="w-28">
                    <NumberInput
                      value={settings.minCaptureMs}
                      min={100}
                      max={5000}
                      step={50}
                      unit="ms"
                      onChange={(value) => {
                        update({ minCaptureMs: value });
                      }}
                    />
                  </div>
                }
              />
              <SettingsRow
                label="Longest capture"
                hint="Longer captures are force-stopped."
                control={
                  <div className="w-32">
                    <NumberInput
                      value={settings.maxCaptureMs}
                      min={5000}
                      max={600000}
                      step={1000}
                      unit="ms"
                      onChange={(value) => {
                        update({ maxCaptureMs: value });
                      }}
                    />
                  </div>
                }
              />
              <SettingsRow
                label="Pre-roll"
                hint="Kept from before the key went down, so early words survive."
                control={
                  <div className="w-28">
                    <NumberInput
                      value={settings.prerollMs}
                      min={0}
                      max={1000}
                      step={50}
                      unit="ms"
                      onChange={(value) => {
                        update({ prerollMs: value });
                      }}
                    />
                  </div>
                }
              />
            </div>
          </Disclosure>
        </div>
      </SettingsGroup>
    </div>
  );
}
