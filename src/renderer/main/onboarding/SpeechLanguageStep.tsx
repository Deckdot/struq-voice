import type { JSX } from "react";
import type { Settings } from "../../../shared/settings";
import { SPEECH_LANGUAGES } from "../../../shared/settings";
import { Select } from "../components/ui";
import { useTranslation } from "../lib/useTranslation";
import { ReadyRow } from "./StepShell";

/**
 * The language the user speaks, which is not the language the app is in.
 * Pinning it is what stops a Dutch dictation coming back with English words:
 * per-utterance auto-detect on a few seconds of speech is a far weaker signal
 * than the language the user already told us.
 *
 * The step arrives preselected from the OS preferred languages, so the common
 * case is one confirming click. "Detect automatically" stays available as an
 * explicit choice for people who really do switch language mid-session; it is
 * simply no longer the silent default.
 */
export interface SpeechLanguageStepProps {
  readonly settings: Settings;
  readonly onChange: (patch: Partial<Settings>) => void;
}

export function SpeechLanguageStep({
  settings,
  onChange
}: SpeechLanguageStepProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <ReadyRow
      label={t("onboarding.speech.label")}
      value={t("onboarding.speech.value")}
      ready={settings.speechLanguage !== "auto"}
      action={
        <div className="w-56">
          <Select
            aria-label={t("onboarding.speech.label")}
            value={settings.speechLanguage}
            onChange={(event) => {
              onChange({ speechLanguage: event.target.value });
            }}
          >
            <option value="auto">{t("onboarding.speech.auto")}</option>
            {SPEECH_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </Select>
        </div>
      }
    />
  );
}
