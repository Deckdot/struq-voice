import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import type { CaptureState } from "../../../shared/capture";
import type { OnboardingProfileResult } from "../../../shared/ipc";
import type { Settings } from "../../../shared/settings";
import { Button } from "../components/ui";
import { StepShell } from "./StepShell";
import { MicrophoneStep } from "./MicrophoneStep";
import { SpeechLanguageStep } from "./SpeechLanguageStep";
import { HotkeyStep } from "./HotkeyStep";
import { EngineStep } from "./EngineStep";
import { TryItStep } from "./TryItStep";

/**
 * First-run setup. Six moments:
 *   1. Microphone (arrives satisfied; live meter is the proof)
 *   2. Speech language (preselected from the OS; one confirming click)
 *   3. Shortcuts (both already registered)
 *   4. Model (download starts on mount, not on arrival)
 *   5. Try it (real capture; the proof the setup works)
 *   6. Done (calm completion; "you are ready")
 *
 * Skipping is always available, defaults are already applied, and
 * completion lands in settings.onboarding.completed.
 */

import { useTranslation } from "../lib/useTranslation";

const STEP_COUNT = 5;

export interface OnboardingProps {
  readonly settings: Settings;
  readonly capture: CaptureState;
  readonly onFinished: () => void;
}

export function Onboarding({ settings, capture, onFinished }: OnboardingProps): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [local, setLocal] = useState<Settings>(settings);
  const [micReady, setMicReady] = useState(false);
  const [profile, setProfile] = useState<OnboardingProfileResult | null>(null);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [installed, setInstalled] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const lastTick = useRef<{ atMs: number; bytes: number } | null>(null);
  /**
   * The latest persisted speech language, so the OS preselect can check
   * "still the default?" without depending on settings and re-running the
   * profile fetch on every unrelated settings change.
   */
  const speechLanguageRef = useRef(settings.speechLanguage);
  speechLanguageRef.current = local.speechLanguage;

  const update = useCallback(
    (patch: Partial<Settings>): void => {
      setLocal((current) => ({ ...current, ...patch }));
      void api.settings.update(patch);
    },
    [api]
  );

  const stepCopy: readonly { title: string; description: string }[] = [
    {
      title: t("onboarding.step.mic.title"),
      description: t("onboarding.step.mic.desc")
    },
    {
      title: t("onboarding.step.speech.title"),
      description: t("onboarding.step.speech.desc")
    },
    {
      title: t("onboarding.step.keys.title"),
      description: t("onboarding.step.keys.desc")
    },
    {
      title: t("onboarding.step.model.title"),
      description: t("onboarding.step.model.desc")
    },
    {
      title: t("onboarding.step.try.title"),
      description: t("onboarding.step.try.desc")
    }
  ];

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void api.onboarding.profile().then((result) => {
      if (cancelled) return;
      setProfile(result);
      setInstalled(result.modelInstalled);
      // Preselect from the OS so the step is one confirming click. Only from
      // the "auto" default: a language already chosen is the user's, and this
      // must never overwrite it on a re-run of onboarding. The ref holds the
      // latest persisted value, so this does not have to depend on settings
      // and re-run the whole profile fetch every time they change.
      if (
        result.suggestedSpeechLanguage !== "auto" &&
        speechLanguageRef.current === "auto"
      ) {
        update({ speechLanguage: result.suggestedSpeechLanguage });
      }
      if (result.modelInstalled) return;
      void api.onboarding.startRecommended().then((started) => {
        if (cancelled) return;
        if (!started.started && started.message !== undefined) {
          if (started.message.startsWith("Already")) setInstalled(true);
          else setFailure(started.message);
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [api, update]);

  useEffect(() => {
    return api.models.onDownloadProgress((event) => {
      if (profile === null || event.modelId !== profile.recommendation.modelId) return;
      if (event.state === "done") {
        setInstalled(true);
        return;
      }
      if (event.state === "error") {
        // A failed download must flip the step off "Downloading" and show the
        // cause; without the terminal push it would spin forever.
        setInstalled(false);
        setFailure(event.message);
        return;
      }
      setReceivedBytes(event.receivedBytes);

      const now = Date.now();
      const previous = lastTick.current;
      if (previous !== null && now > previous.atMs) {
        const perSecond = ((event.receivedBytes - previous.bytes) * 1000) / (now - previous.atMs);
        if (perSecond > 0) {
          void perSecond;
        }
      }
      lastTick.current = { atMs: now, bytes: event.receivedBytes };

      if (event.totalBytes > 0 && event.receivedBytes >= event.totalBytes) {
        setInstalled(true);
      }
    });
  }, [api, profile]);

  useEffect(() => {
    if (capture.phase === "delivering" && capture.text.trim() !== "") {
      setTranscript(capture.text);
    }
  }, [capture]);

  const finish = useCallback((): void => {
    void api.onboarding.complete().then(() => {
      onFinished();
    });
  }, [api, onFinished]);

  const completed: readonly boolean[] = [
    micReady,
    local.speechLanguage !== "auto",
    true,
    installed,
    transcript !== null
  ];

  const last = step === STEP_COUNT - 1;
  const copy = stepCopy[step] ?? stepCopy[0] ?? { title: "", description: "" };

  if (showDone) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-bg px-8 py-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="flex w-full max-w-md flex-col items-center gap-4 text-center"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-pill border border-success bg-surface text-success">
            <Icon icon="ph:check" className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="font-display text-2xl font-medium tracking-tight text-text">
            {t("onboarding.done.title")}
          </h1>
          <p className="max-w-sm text-sm text-text-muted">
            {t("onboarding.done.body")}
          </p>
          <Button variant="primary" size="lg" onClick={finish}>
            {t("onboarding.done.startBtn")}
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 bg-bg text-text" data-selectable>
      <StepShell
        stepIndex={step}
        stepCount={STEP_COUNT}
        completed={completed}
        title={copy.title}
        description={copy.description}
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                if (last && transcript !== null) {
                  setShowDone(true);
                } else {
                  finish();
                }
              }}
            >
              {last ? t("onboarding.skipLast") : t("onboarding.skip")}
            </Button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setStep((current) => current - 1);
                  }}
                >
                  {t("onboarding.back")}
                </Button>
              )}
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  if (last) {
                    if (transcript !== null) {
                      setShowDone(true);
                    } else {
                      finish();
                    }
                    return;
                  }
                  setStep((current) => current + 1);
                }}
              >
                {last ? t("onboarding.finish") : t("onboarding.continue")}
              </Button>
            </div>
          </>
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-3"
          >
            {step === 0 && <MicrophoneStep onReady={setMicReady} />}
            {step === 1 && <SpeechLanguageStep settings={local} onChange={update} />}
            {step === 2 && <HotkeyStep settings={local} onChange={update} />}
            {step === 3 && (
              <EngineStep
                profile={profile}
                receivedBytes={receivedBytes}
                bytesPerSecond={null}
                installed={installed}
                failure={failure}
              />
            )}
            {step === 4 && (
              <TryItStep
                settings={local}
                capture={capture}
                transcript={transcript}
                modelReady={installed}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </StepShell>
    </div>
  );
}
