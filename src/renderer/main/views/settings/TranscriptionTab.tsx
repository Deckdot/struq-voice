import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { SPEECH_LANGUAGES } from "../../../../shared/settings";
import { ENGINE_OPTIONS } from "../../../../shared/engines";
import type { EngineOption } from "../../../../shared/engines";
import { MODEL_CATALOG } from "../../../../shared/models";
import { Button, Card, Field, RadioGroup, Select, SettingsGroup, SettingsRow, TextInput, formatBytes } from "../../components/ui";
import type { RadioOption } from "../../components/ui";

const WHISPER_MODELS = MODEL_CATALOG.filter((model) => model.engine === "whisper-cpp");

/**
 * The Transcription settings tab: which voice service is on, what runs
 * when the main one cannot, the cloud key, the Whisper model picker.
 */
export interface TranscriptionTabProps {
  readonly api: MainWindowApi;
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
}

import { useTranslation } from "../../lib/useTranslation";

export function TranscriptionTab({ api, settings, update }: TranscriptionTabProps): JSX.Element {
  const { t } = useTranslation();
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyStored, setKeyStored] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyEditing, setKeyEditing] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);

  useEffect(() => {
    void api.openRouterKey.status().then((status) => {
      setKeyConfigured(status.configured);
      setKeyStored(status.stored);
    });
  }, [api, keyEditing]);

  const saveKey = (): void => {
    const trimmed = keyInput.trim();
    if (trimmed.length === 0) return;
    setSavePending(true);
    void api.openRouterKey
      .set(trimmed)
      .then((result) => {
        if (result.ok) {
          setKeyMessage("API key saved.");
          setKeyEditing(false);
          setKeyInput("");
        } else {
          setKeyMessage(result.message ?? "Could not save the key.");
        }
      })
      .finally(() => {
        setSavePending(false);
      });
  };

  /**
   * Read the key from the clipboard through main. The Edit menu roles are the
   * only thing that delivers Ctrl+V to a sandboxed renderer on Windows, and
   * they do not always arrive, so this button is the route that always works.
   */
  const pasteKey = (): void => {
    void api.clipboard.read().then((text) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      setKeyInput(trimmed);
      setKeyMessage(null);
    });
  };

  const clearKey = (): void => {
    void api.openRouterKey.clear().then((result) => {
      if (result.ok) {
        setKeyMessage("API key removed.");
        setKeyConfigured(false);
        setKeyStored(false);
      } else {
        setKeyMessage(result.message ?? "Could not remove the key.");
      }
    });
  };

  const engineToOption = (option: EngineOption): RadioOption<string> => ({
    value: option.id,
    label: option.displayName,
    description: option.hint,
    badge: option.kind === "cloud" ? t("settings.transcription.badge.cloud") : option.kind === "test" ? t("settings.transcription.badge.practice") : t("settings.transcription.badge.local"),
    tone: option.kind === "cloud" ? "warning" : "neutral",
    icon: option.kind === "cloud" ? "ph:cloud" : option.kind === "test" ? "ph:flask" : "ph:desktop-tower"
  });

  const options = ENGINE_OPTIONS.map(engineToOption);
  const cloudEngines = ENGINE_OPTIONS.filter((option) => option.kind === "cloud");
  const localEngines = ENGINE_OPTIONS.filter((option) => option.kind === "local");
  const isCloud = settings.engine.primary === "openrouter";

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title={t("settings.transcription.service.title")}
        description={t("settings.transcription.service.subtitle")}
      >
        <RadioGroup
          value={settings.engine.primary}
          onChange={(next) => {
            update({ engine: { primary: next, fallback: settings.engine.fallback } });
          }}
          options={options}
        />
      </SettingsGroup>

      {isCloud && (
        <Card className="border-border bg-surface">
          <div className="flex items-center gap-3">
            <Icon icon="ph:warning-circle" className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-text">{t("settings.transcription.cloudWarning.title")}</p>
              <p className="mt-1 text-sm text-text-muted">
                {t("settings.transcription.cloudWarning")}
              </p>
            </div>
          </div>
        </Card>
      )}

      <SettingsGroup title={t("settings.transcription.fallback.title")}>
        <SettingsRow
          label={t("settings.transcription.fallback.label")}
          control={
            <div className="w-56">
              <Select
                value={settings.engine.fallback ?? "none"}
                onChange={(event) => {
                  const value = event.target.value === "none" ? null : event.target.value;
                  update({ engine: { ...settings.engine, fallback: value } });
                }}
              >
                <option value="none">{t("settings.transcription.none")}</option>
                <optgroup label={t("settings.transcription.fallback.localGroup")}>
                  {localEngines.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("settings.transcription.fallback.onlineGroup")}>
                  {cloudEngines.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </div>
          }
        />
      </SettingsGroup>

      {settings.engine.primary === "whisper-cpp" && (
        <SettingsGroup
          title={t("settings.transcription.whisperModel.title")}
          description={t("settings.transcription.whisperModel.subtitle")}
        >
          <SettingsRow
            label={t("settings.transcription.whisperModel.label")}
            control={
              <div className="w-72">
                <Select
                  aria-label="Whisper model"
                  value={settings.whisperModelId}
                  onChange={(event) => {
                    update({ whisperModelId: event.target.value });
                  }}
                >
                  {WHISPER_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({formatBytes(model.bytes)})
                    </option>
                  ))}
                </Select>
              </div>
            }
          />
        </SettingsGroup>
      )}

      <SettingsGroup
        title={t("settings.transcription.openrouter.title")}
        description={t("settings.transcription.openrouter.subtitle")}
      >
        {keyEditing ? (
          <div className="px-4 py-3">
            <Field label={t("settings.transcription.openrouter.pasteLabel")} hint={t("settings.transcription.openrouter.pasteHint")}>
              <div className="flex items-center gap-2">
                <TextInput
                  type="password"
                  value={keyInput}
                  onChange={(event) => {
                    setKeyInput(event.target.value);
                    setKeyMessage(null);
                  }}
                  placeholder="sk-or-v1-..."
                  className="font-mono"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={pasteKey}
                  title={t("settings.transcription.openrouter.pasteBtn")}
                >
                  <Icon icon="ph:clipboard-text" className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("settings.transcription.openrouter.pasteBtn")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveKey}
                  disabled={keyInput.trim().length === 0 || savePending}
                >
                  <Icon icon="ph:check" className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("settings.transcription.openrouter.saveBtn")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setKeyEditing(false);
                    setKeyInput("");
                    setKeyMessage(null);
                  }}
                >
                  <Icon icon="ph:x" className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("settings.transcription.openrouter.cancelBtn")}
                </Button>
              </div>
            </Field>
          </div>
        ) : (
          <SettingsRow
            label={t("settings.transcription.openrouter.keyLabel")}
            hint={
              keyConfigured
                ? keyStored
                  ? t("settings.transcription.openrouter.storedHint")
                  : t("settings.transcription.openrouter.envHint")
                : t("settings.transcription.openrouter.notConfigured")
            }
            control={
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setKeyEditing(true);
                    setKeyMessage(null);
                  }}
                >
                  {keyStored ? t("settings.transcription.openrouter.replaceBtn") : t("settings.transcription.openrouter.addBtn")}
                </Button>
                {keyStored && (
                  <Button variant="ghost" size="sm" onClick={clearKey}>
                    {t("settings.transcription.openrouter.removeBtn")}
                  </Button>
                )}
              </div>
            }
          />
        )}
        {keyMessage !== null && (
          <p className="px-4 pb-3 text-sm text-text-muted">{keyMessage}</p>
        )}
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.transcription.speechLanguage.title")}
        description={t("settings.transcription.speechLanguage.subtitle")}
      >
        <SettingsRow
          label={t("settings.transcription.speechLanguage.label")}
          hint={t("settings.transcription.speechLanguage.hint")}
          control={
            <div className="w-72">
              <Select
                value={settings.speechLanguage}
                onChange={(event) => {
                  update({ speechLanguage: event.target.value });
                }}
              >
                <option value="auto">{t("settings.transcription.speechLanguage.auto")}</option>
                {SPEECH_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
      </SettingsGroup>
    </div>
  );
}
