import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../../shared/api";
import type { Settings } from "../../../../shared/settings";
import { ENGINE_OPTIONS } from "../../../../shared/engines";
import type { EngineOption } from "../../../../shared/engines";
import { MODEL_CATALOG } from "../../../../shared/models";
import { Button, Card, Field, RadioGroup, Select, SettingsGroup, SettingsRow, TextInput, formatBytes } from "../../components/ui";
import type { RadioOption } from "../../components/ui";

const WHISPER_MODELS = MODEL_CATALOG.filter((model) => model.engine === "whisper-cpp");

const engineToOption = (option: EngineOption): RadioOption<string> => ({
  value: option.id,
  label: option.displayName,
  description: option.hint,
  badge: option.kind === "cloud" ? "Cloud" : option.kind === "test" ? "Practice" : "Local",
  tone: option.kind === "cloud" ? "warning" : "neutral",
  icon: option.kind === "cloud" ? "ph:cloud" : option.kind === "test" ? "ph:flask" : "ph:desktop-tower"
});

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

  const options = ENGINE_OPTIONS.map(engineToOption);
  const cloudEngines = ENGINE_OPTIONS.filter((option) => option.kind === "cloud");
  const localEngines = ENGINE_OPTIONS.filter((option) => option.kind === "local");
  const isCloud = settings.engine.primary === "openrouter";

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title="Main voice service"
        description="Local services keep audio on this computer."
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
              <p className="text-sm font-medium text-text">Your audio leaves this computer.</p>
              <p className="mt-1 text-sm text-text-muted">
                OpenRouter processes your recording on its servers. Use a local service if you would
                rather keep recordings here.
              </p>
            </div>
          </div>
        </Card>
      )}

      <SettingsGroup title="Backup service">
        <SettingsRow
          label="If the main service fails"
          hint="Tried only when the main service cannot help."
          control={
            <div className="w-56">
              <Select
                value={settings.engine.fallback ?? "none"}
                onChange={(event) => {
                  const value = event.target.value === "none" ? null : event.target.value;
                  update({ engine: { ...settings.engine, fallback: value } });
                }}
              >
                <option value="none">No backup</option>
                <optgroup label="Local services">
                  {localEngines.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Online services">
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
          title="Whisper model"
          description="Bigger models are slower but handle accents better."
        >
          <SettingsRow
            label="Active model"
            hint="Only installed models are available here."
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
        title="OpenRouter API key"
        description="Stored encrypted on this computer."
      >
        {keyEditing ? (
          <div className="px-4 py-3">
            <Field label="Paste your key" hint="Begins with sk-or-v1-.">
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
                  variant="primary"
                  size="sm"
                  onClick={saveKey}
                  disabled={keyInput.trim().length === 0 || savePending}
                >
                  <Icon icon="ph:check" className="h-3.5 w-3.5" aria-hidden="true" />
                  Save
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
                  Cancel
                </Button>
              </div>
            </Field>
          </div>
        ) : (
          <SettingsRow
            label="Stored key"
            hint={
              keyConfigured
                ? keyStored
                  ? "An API key is stored on this computer."
                  : "Configured through the OPENROUTER_API_KEY environment variable."
                : "No key is configured yet."
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
                  {keyStored ? "Replace key" : "Add key"}
                </Button>
                {keyStored && (
                  <Button variant="ghost" size="sm" onClick={clearKey}>
                    Remove
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
        description="Select the target language for speech decoding. Separate from the interface language."
      >
        <SettingsRow
          label={t("settings.transcription.speechLanguage.label")}
          hint="Forcing the language improves accuracy and speed."
          control={
            <div className="w-56">
              <Select
                value={settings.speechLanguage}
                onChange={(event) => {
                  update({ speechLanguage: event.target.value });
                }}
              >
                <option value="auto">{t("settings.transcription.speechLanguage.auto")}</option>
                <option value="en">English</option>
                <option value="de">German (Deutsch)</option>
                <option value="fr">French (Français)</option>
                <option value="es">Spanish (Español)</option>
                <option value="it">Italian (Italiano)</option>
                <option value="nl">Dutch (Nederlands)</option>
                <option value="pt">Portuguese (Português)</option>
                <option value="pl">Polish (Polski)</option>
                <option value="ru">Russian (Русский)</option>
                <option value="zh">Chinese (中文)</option>
                <option value="ja">Japanese (日本語)</option>
                <option value="ko">Korean (한국어)</option>
                <option value="ar">Arabic (العربية)</option>
                <option value="hi">Hindi (हिन्दी)</option>
                <option value="tr">Turkish (Türkçe)</option>
                <option value="sv">Swedish (Svenska)</option>
                <option value="da">Danish (Dansk)</option>
                <option value="nb">Norwegian (Norsk)</option>
                <option value="fi">Finnish (Suomi)</option>
                <option value="uk">Ukrainian (Українська)</option>
              </Select>
            </div>
          }
        />
      </SettingsGroup>
    </div>
  );
}
