import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { MainWindowApi } from "../../../shared/api";
import type { CaptureState } from "../../../shared/capture";
import type { OnboardingProfileResult } from "../../../shared/ipc";
import type { Settings } from "../../../shared/settings";
import { Button } from "../components/ui";
import { EngineStep } from "./EngineStep";
import { HotkeyStep } from "./HotkeyStep";
import { MicrophoneStep } from "./MicrophoneStep";
import { StepShell } from "./StepShell";
import { TryItStep } from "./TryItStep";

/**
 * First run, once. Four steps, each shipping a working default already
 * applied, so continuing is always safe and skipping costs nothing.
 *
 * The model download starts the moment this mounts rather than when the
 * engine step is reached. Setup effort demanded before the product has shown
 * what it does gets abandoned, so the wait is spent on the steps that need a
 * human rather than on a progress bar.
 */
export interface OnboardingProps {
  readonly settings: Settings;
  readonly capture: CaptureState;
  readonly onFinished: () => void;
}

const STEP_COUNT = 4;

const STEP_COPY: readonly { title: string; description: string }[] = [
  {
    title: "Your microphone",
    description: "Already selected. Check the meter moves when you speak."
  },
  {
    title: "Your key",
    description: "Hold it anywhere in Windows, speak, and release. Change it if it clashes."
  },
  {
    title: "Your model",
    description: "Chosen for this machine and downloading now. Transcription stays on your PC."
  },
  {
    title: "Try it",
    description: "Hold the key and say something. This is the whole product."
  }
];

export function Onboarding({ settings, capture, onFinished }: OnboardingProps): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [step, setStep] = useState(0);
  const [local, setLocal] = useState<Settings>(settings);
  const [micReady, setMicReady] = useState(false);
  const [profile, setProfile] = useState<OnboardingProfileResult | null>(null);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [installed, setInstalled] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);

  const lastTick = useRef<{ atMs: number; bytes: number } | null>(null);

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  // Detect, then start the download immediately. Both are safe to repeat:
  // main only ever starts one download per model.
  useEffect(() => {
    let cancelled = false;
    void api.onboarding.profile().then((result) => {
      if (cancelled) return;
      setProfile(result);
      setInstalled(result.modelInstalled);
      if (result.modelInstalled) return;
      void api.onboarding.startRecommended().then((started) => {
        if (cancelled) return;
        if (!started.started && started.message !== undefined) {
          // "Already installed" is a success, not a failure.
          if (started.message.startsWith("Already")) setInstalled(true);
          else setFailure(started.message);
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    return api.models.onDownloadProgress((event) => {
      if (profile === null || event.modelId !== profile.recommendation.modelId) return;
      setReceivedBytes(event.receivedBytes);

      const now = Date.now();
      const previous = lastTick.current;
      if (previous !== null && now > previous.atMs) {
        const perSecond = ((event.receivedBytes - previous.bytes) * 1000) / (now - previous.atMs);
        if (perSecond > 0) setRate(perSecond);
      }
      lastTick.current = { atMs: now, bytes: event.receivedBytes };

      if (event.totalBytes > 0 && event.receivedBytes >= event.totalBytes) {
        setInstalled(true);
      }
    });
  }, [api, profile]);

  // A delivered capture during the last step is the proof the setup works.
  useEffect(() => {
    if (capture.phase === "delivering" && capture.text.trim() !== "") {
      setTranscript(capture.text);
    }
  }, [capture]);

  const update = useCallback(
    (patch: Partial<Settings>): void => {
      setLocal((current) => ({ ...current, ...patch }));
      void api.settings.update(patch);
    },
    [api]
  );

  const finish = useCallback((): void => {
    void api.onboarding.complete().then(() => {
      onFinished();
    });
  }, [api, onFinished]);

  const completed: readonly boolean[] = [
    micReady,
    // Both chords ship registered, so this step is satisfied on arrival and
    // only the user changing their mind can alter it.
    true,
    installed,
    transcript !== null
  ];

  const last = step === STEP_COUNT - 1;
  const copy = STEP_COPY[step] ?? STEP_COPY[0];

  return (
    <div className="flex min-h-0 flex-1 bg-bg text-text" data-selectable>
      <StepShell
        stepIndex={step}
        stepCount={STEP_COUNT}
        completed={completed}
        title={copy?.title ?? ""}
        description={copy?.description ?? ""}
        actions={
          <>
            {/* Leaving is as cheap as continuing, and still leaves a working
                app: every step's default is already applied. */}
            <Button variant="ghost" size="md" onClick={finish}>
              {last ? "Skip" : "Skip setup"}
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
                  Back
                </Button>
              )}
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  if (last) finish();
                  else setStep((current) => current + 1);
                }}
              >
                {last ? "Start using Struq Voice" : "Continue"}
              </Button>
            </div>
          </>
        }
      >
        {step === 0 && <MicrophoneStep onReady={setMicReady} />}
        {step === 1 && <HotkeyStep settings={local} onChange={update} />}
        {step === 2 && (
          <EngineStep
            profile={profile}
            receivedBytes={receivedBytes}
            bytesPerSecond={rate}
            installed={installed}
            failure={failure}
          />
        )}
        {step === 3 && (
          <TryItStep
            settings={local}
            capture={capture}
            transcript={transcript}
            modelReady={installed}
          />
        )}
      </StepShell>
    </div>
  );
}
