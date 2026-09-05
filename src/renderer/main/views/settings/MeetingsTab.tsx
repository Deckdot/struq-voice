import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { Settings } from "../../../../shared/settings";
import type { MainWindowApi } from "../../../../shared/api";
import { MODEL_CATALOG } from "../../../../shared/models";
import {
  Disclosure,
  HotkeyRecorder,
  NumberInput,
  SegmentedControl,
  Select,
  SettingsGroup,
  SettingsRow,
  Slider,
  Switch
} from "../../components/ui";

import { useTranslation } from "../../lib/useTranslation";

/**
 * The Meetings settings tab: recording behaviour, the transcription engine,
 * speaker labelling, and the advanced VAD knobs behind a disclosure. Every
 * write sends the whole meeting object, because SettingsStore.update is a
 * shallow merge.
 */
export interface MeetingsTabProps {
  readonly api: MainWindowApi;
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
}

export function MeetingsTab({ api, settings, update }: MeetingsTabProps): JSX.Element {
  const { t } = useTranslation();
  const meeting = settings.meeting;
  const whisperModels = MODEL_CATALOG.filter((model) => model.engine === "whisper-cpp");
  const [installedModelIds, setInstalledModelIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  useEffect(() => {
    void api.models.list().then(({ items }) => {
      setInstalledModelIds(
        new Set(items.filter((item) => item.installed).map((item) => item.model.id))
      );
    });
  }, [api]);

  const updateMeeting = (patch: Partial<typeof meeting>): void => {
    update({ meeting: { ...meeting, ...patch } });
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t("settings.meetings.recording.title")}>
        <SettingsRow
          label={t("settings.meetings.recording.hotkey.label")}
          hint={t("settings.meetings.recording.hotkey.hint")}
          control={
            <HotkeyRecorder
              label="meeting toggle key"
              accelerator={meeting.accelerator}
              size="md"
              onChange={(accelerator) => {
                updateMeeting({ accelerator });
              }}
            />
          }
        />
        <SettingsRow
          label={t("settings.meetings.recording.microphone.label")}
          hint={t("settings.meetings.recording.microphone.hint")}
          control={
            <Switch
              checked={meeting.includeMicrophone}
              onChange={(includeMicrophone) => {
                updateMeeting({ includeMicrophone });
              }}
            />
          }
        />
        <SettingsRow
          label={t("settings.meetings.recording.archive.label")}
          hint={t("settings.meetings.recording.archive.hint")}
          control={
            <Switch
              checked={meeting.archiveAudio}
              onChange={(archiveAudio) => {
                updateMeeting({ archiveAudio });
              }}
            />
          }
        />
        <SettingsRow
          label={t("settings.meetings.recording.quality.label")}
          hint={t("settings.meetings.recording.quality.hint", {
            perHour: t("settings.meetings.recording.quality.perHour")
          })}
          control={
            <SegmentedControl
              value={String(meeting.archiveBitrateKbps)}
              onChange={(value) => {
                updateMeeting({ archiveBitrateKbps: Number(value) });
              }}
              options={[
                { value: "16", label: "16" },
                { value: "32", label: "32" },
                { value: "64", label: "64" }
              ]}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.meetings.transcription.title")}>
        <SettingsRow
          label={t("settings.meetings.transcription.engine.label")}
          hint={t("settings.meetings.transcription.engine.hint")}
          control={
            <div className="w-72">
              <Select
                aria-label="Meeting transcription engine"
                value={meeting.engineId}
                onChange={(event) => {
                  updateMeeting({
                    engineId: event.target.value as "parakeet" | "whisper-cpp" | "openrouter"
                  });
                }}
              >
                <option value="whisper-cpp">Whisper Large Turbo, local</option>
                <option value="parakeet">Parakeet, local</option>
                <option value="openrouter">OpenRouter Whisper, online</option>
              </Select>
            </div>
          }
        />
        {meeting.engineId === "whisper-cpp" && (
          <SettingsRow
            label={t("settings.meetings.transcription.model.label")}
            hint={t("settings.meetings.transcription.model.hint")}
            control={
              <div className="w-72">
                <Select
                  aria-label="Meeting Whisper model"
                  value={meeting.whisperModelId}
                  onChange={(event) => {
                    updateMeeting({ whisperModelId: event.target.value });
                  }}
                >
                  {whisperModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}{installedModelIds.has(model.id) ? "" : " (not downloaded)"}
                    </option>
                  ))}
                </Select>
              </div>
            }
          />
        )}
        {meeting.engineId === "openrouter" && (
          <div className="rounded-md border border-warning bg-warning-soft px-4 py-3 text-sm text-text">
            <p className="font-medium">{t("settings.meetings.transcription.cloud.title")}</p>
            <p className="mt-1 text-text-muted">{t("settings.meetings.transcription.cloud.hint")}</p>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("settings.meetings.speakers.title")}>
        <SettingsRow
          label={t("settings.meetings.speakers.label.label")}
          hint={t("settings.meetings.speakers.label.hint")}
          control={
            <Switch
              checked={meeting.diarization}
              onChange={(diarization) => {
                updateMeeting({ diarization });
              }}
            />
          }
        />
        <SettingsRow
          label={t("settings.meetings.speakers.sensitivity.label")}
          hint={t("settings.meetings.speakers.sensitivity.hint")}
          control={
            <div className="w-72">
              <Slider
                min={0.2}
                max={0.95}
                step={0.05}
                value={meeting.speakerThreshold}
                onChange={(speakerThreshold) => {
                  updateMeeting({ speakerThreshold });
                }}
                aria-label="Speaker sensitivity"
              />
              <div className="mt-1 flex justify-between text-xs text-text-muted">
                <span>{t("settings.meetings.speakers.sensitivity.merge")}</span>
                <span>{t("settings.meetings.speakers.sensitivity.keepApart")}</span>
              </div>
            </div>
          }
        />
        <SettingsRow
          label={t("settings.meetings.speakers.minAudio.label")}
          hint={t("settings.meetings.speakers.minAudio.hint")}
          control={
            <NumberInput
              value={meeting.minSpeakerAudioMs}
              min={500}
              max={10_000}
              step={500}
              onChange={(minSpeakerAudioMs) => {
                updateMeeting({ minSpeakerAudioMs });
              }}
              aria-label="Minimum speech to identify a speaker"
            />
          }
        />
        <SettingsRow
          label={t("settings.meetings.speakers.max.label")}
          hint={t("settings.meetings.speakers.max.hint")}
          control={
            <NumberInput
              value={meeting.maxSpeakers}
              min={0}
              max={32}
              onChange={(maxSpeakers) => {
                updateMeeting({ maxSpeakers });
              }}
              aria-label="Expected speakers"
            />
          }
        />
      </SettingsGroup>

      <Disclosure label={t("settings.meetings.advanced.title")}>
        <div className="flex flex-col gap-6">
          <SettingsGroup title={t("settings.meetings.advanced.vad.title")}>
            <SettingsRow
              label={t("settings.meetings.advanced.vad.minSpeech.label")}
              hint={t("settings.meetings.advanced.vad.minSpeech.hint")}
              control={
                <NumberInput
                  value={meeting.vadMinSpeechMs}
                  min={100}
                  max={2000}
                  step={50}
                  onChange={(vadMinSpeechMs) => {
                    updateMeeting({ vadMinSpeechMs });
                  }}
                  aria-label="Minimum speech length"
                />
              }
            />
            <SettingsRow
              label={t("settings.meetings.advanced.vad.minSilence.label")}
              hint={t("settings.meetings.advanced.vad.minSilence.hint")}
              control={
                <NumberInput
                  value={meeting.vadMinSilenceMs}
                  min={200}
                  max={3000}
                  step={50}
                  onChange={(vadMinSilenceMs) => {
                    updateMeeting({ vadMinSilenceMs });
                  }}
                  aria-label="Minimum silence length"
                />
              }
            />
            <SettingsRow
              label={t("settings.meetings.advanced.vad.maxSpeech.label")}
              hint={t("settings.meetings.advanced.vad.maxSpeech.hint")}
              control={
                <NumberInput
                  value={meeting.vadMaxSpeechMs}
                  min={5000}
                  max={60_000}
                  step={1000}
                  onChange={(vadMaxSpeechMs) => {
                    updateMeeting({ vadMaxSpeechMs });
                  }}
                  aria-label="Maximum speech length"
                />
              }
            />
            <SettingsRow
              label={t("settings.meetings.advanced.refine.label")}
              hint={t("settings.meetings.advanced.refine.hint")}
              control={
                <NumberInput
                  value={meeting.diarizationRefineOverMs}
                  min={0}
                  max={60_000}
                  step={1000}
                  onChange={(diarizationRefineOverMs) => {
                    updateMeeting({ diarizationRefineOverMs });
                  }}
                  aria-label="Refinement threshold"
                />
              }
            />
          </SettingsGroup>
          <SettingsGroup title={t("settings.meetings.advanced.housekeeping.title")}>
            <SettingsRow
              label={t("settings.meetings.advanced.autoStop.label")}
              hint={t("settings.meetings.advanced.autoStop.hint")}
              control={
                <NumberInput
                  value={meeting.autoStopSilentMinutes}
                  min={0}
                  max={120}
                  onChange={(autoStopSilentMinutes) => {
                    updateMeeting({ autoStopSilentMinutes });
                  }}
                  aria-label="Auto stop after silence"
                />
              }
            />
            <SettingsRow
              label={t("settings.meetings.advanced.retention.label")}
              hint={t("settings.meetings.advanced.retention.hint")}
              control={
                <NumberInput
                  value={meeting.retentionDays}
                  min={0}
                  max={3650}
                  onChange={(retentionDays) => {
                    updateMeeting({ retentionDays });
                  }}
                  aria-label="Retention days"
                />
              }
            />
          </SettingsGroup>
        </div>
      </Disclosure>
    </div>
  );
}
