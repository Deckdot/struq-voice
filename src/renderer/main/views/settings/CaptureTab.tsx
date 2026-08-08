import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../../shared/api";
import type { RecorderDevice } from "../../../../shared/ipc";
import type { Settings } from "../../../../shared/settings";
import {
  HotkeyRecorder,
  NumberInput,
  Select,
  SettingsGroup,
  SettingsRow,
  Slider,
  Switch
} from "../../components/ui";
import { MicrophoneMeter } from "../../components/MicrophoneMeter";

import { useTranslation } from "../../lib/useTranslation";

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
  const { t } = useTranslation();
  const [level, setLevel] = useState(0);

  useEffect(() => {
    // The meter exists to test the microphone without starting a capture, so
    // it has to ask main to keep the analyser loop running.
    const releaseLevels = api.requestCaptureLevels();
    const unsubscribe = api.onCaptureLevelsChanged(({ level: next }) => {
      setLevel((current) => Math.max(current * 0.6, next * 0.4));
    });
    return () => {
      unsubscribe();
      releaseLevels();
    };
  }, [api]);

  const meterValue = Math.min(100, Math.max(0, Math.round(level * 100)));
  const signalDetected = meterValue >= 3;

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title={t("settings.general.hotkeys.title")}
      >
        <SettingsRow
          label={t("settings.general.ptt.label")}
          hint={t("settings.general.ptt.hint")}
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
          label={t("settings.general.toggle.label")}
          hint={t("settings.general.toggle.hint")}
          control={
            <HotkeyRecorder
              label="press to toggle key"
              accelerator={settings.toggleAccelerator}
              size="md"
              onChange={(toggleAccelerator) => {
                update({ toggleAccelerator });
              }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.capture.device.title")}
      >
        <SettingsRow
          label={t("settings.capture.device.label")}
          hint={t("settings.capture.device.permissionHint")}
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
                {devices.length === 0 && <option value="">{t("settings.capture.device.none")}</option>}
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <div className="px-4 py-3">
          <div className="mb-2 flex h-5 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Icon
                icon="ph:waveform"
                className={signalDetected ? "h-4 w-4 shrink-0 text-accent" : "h-4 w-4 shrink-0 text-text-muted"}
                aria-hidden="true"
              />
              <span className="text-xs font-medium text-text">
                {signalDetected ? t("settings.capture.device.signalDetected") : t("settings.capture.device.speakToTest")}
              </span>
            </div>
            <span className="shrink-0 text-2xs text-text-muted tabular-nums" data-numeric>
              {String(meterValue)}%
            </span>
          </div>
          <MicrophoneMeter level={level} label={t("settings.capture.device.meterLabel")} />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.capture.audio.title")}
        description={t("settings.capture.audio.subtitle")}
      >
        <SettingsRow
          label={t("settings.capture.sounds.label")}
          hint={t("settings.capture.sounds.hint")}
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
          label={t("settings.capture.volume.label")}
          hint={t("settings.capture.volume.hint")}
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
        title={t("settings.capture.live.title")}
        description={t("settings.capture.live.subtitle")}
      >
        <SettingsRow
          label={t("settings.capture.live.label")}
          hint={t("settings.capture.live.hint")}
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
          label={t("settings.capture.live.refreshLabel")}
          hint={t("settings.capture.live.refreshHint")}
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
        title={t("settings.capture.duration.title")}
      >
        <SettingsRow
          label={t("settings.capture.minDuration.label")}
          hint={t("settings.capture.minDuration.hintText")}
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
          label={t("settings.capture.maxDuration.label")}
          hint={t("settings.capture.maxDuration.hintText")}
          control={
            <div className="w-28">
              <NumberInput
                value={Math.round(settings.maxCaptureMs / 1000)}
                min={5}
                max={600}
                step={1}
                unit="s"
                onChange={(value) => {
                  update({ maxCaptureMs: value * 1000 });
                }}
              />
            </div>
          }
        />
        <SettingsRow
          label={t("settings.capture.preroll.label")}
          hint={t("settings.capture.preroll.hintText")}
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
      </SettingsGroup>
    </div>
  );
}
