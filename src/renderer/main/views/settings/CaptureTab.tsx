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
    <div className="flex flex-col gap-8">
      <SettingsGroup
        title="Keys"
        description="The shortcuts for starting and stopping a dictation. Struq Voice re-registers them as soon as you change them."
      >
        <SettingsRow
          label="Hold to record"
          hint="Hold anywhere in Windows, speak, release. The text lands in the field you were using."
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
          hint="Press once to start, once to stop. Useful for longer dictation."
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
        description="The device Struq Voice listens through. If you plug in a different one, choose it here."
      >
        <SettingsRow
          label="Active microphone"
          hint="If the list is empty, Windows has not yet given Struq Voice permission to use the microphone."
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
        description="A short chime when a capture starts and ends. Helps you hear that the microphone is live, even when you are not looking."
      >
        <SettingsRow
          label="Play capture sounds"
          hint="Leave on if you want a confirmation you can hear. Turn off for silent recording."
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
          hint="How loud the chime plays. Has no effect when capture sounds are off."
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
        description="Struq Voice can show the words it has understood so far while you are still speaking. It costs extra processing."
      >
        <SettingsRow
          label="Show words as I speak"
          hint="Useful for long dictation. Off by default because it competes with the final pass on slower machines."
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
        description="The rules that decide what counts as a real dictation. The defaults suit most people; only change these if you know what you want."
      >
        <div className="px-4 py-3">
          <Disclosure label="Advanced capture timing">
            <div className="flex flex-col gap-4">
              <SettingsRow
                label="Shortest capture"
                hint="A capture shorter than this is discarded. Prevents a mistyped key from pasting a single sound."
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
                hint="A capture longer than this is force-stopped. Catches a stuck key."
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
                hint="Audio kept from just before the key went down, so an early first word survives."
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
