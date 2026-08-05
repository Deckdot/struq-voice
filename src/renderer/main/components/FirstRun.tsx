import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Mic, Sparkles, Keyboard, ArrowRight, X } from "lucide-react";
import type { Route } from "../store/use-main-store";

const FIRST_RUN_DISMISSED_KEY = "struq-voice.first-run-dismissed";

export interface FirstRunProps {
  readonly onNavigate: (route: Route) => void;
  readonly onDismissed: () => void;
}

/**
 * First run: three skippable, non-blocking steps (microphone, engine, hotkey)
 * that route into the surfaces they describe. Seen once; dismissing persists.
 */
export function FirstRun({ onNavigate, onDismissed }: FirstRunProps): JSX.Element {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(FIRST_RUN_DISMISSED_KEY) === "1";
    } catch {
      // Storage unavailable; show it.
    }
    setVisible(!dismissed);
  }, []);

  if (!visible) return <></>;

  const dismiss = (): void => {
    try {
      localStorage.setItem(FIRST_RUN_DISMISSED_KEY, "1");
    } catch {
      // Best effort.
    }
    setVisible(false);
    onDismissed();
  };

  const steps = [
    {
      icon: Mic,
      title: "1. Microphone",
      detail: "The app checks your mic at start. A live meter shows it works.",
      action: "Settings",
      route: "settings" as const
    },
    {
      icon: Sparkles,
      title: "2. Engine",
      detail: "Local models need a download; OpenRouter needs a key.",
      action: "Models",
      route: "models" as const
    },
    {
      icon: Keyboard,
      title: "3. Hotkey",
      detail: "Hold Ctrl+Space anywhere in Windows, speak, release.",
      action: "Settings",
      route: "settings" as const
    }
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface p-4 shadow-float">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <p className="font-serif text-lg tracking-tight text-text">Welcome to Struq Voice</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismiss}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-surface-hover hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <button
                key={step.title}
                type="button"
                onClick={() => {
                  onNavigate(step.route);
                }}
                className="flex flex-col items-start gap-1.5 rounded-md border border-border bg-bg p-3 text-left transition-colors duration-fast hover:border-accent hover:bg-accent-soft"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                  <Icon className="h-4 w-4 text-accent-text" aria-hidden="true" />
                  {step.title}
                </span>
                <span className="text-xs leading-snug text-text-muted">{step.detail}</span>
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-accent-text">
                  Open {step.action} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-center text-sm text-text-muted">
          Hold <kbd className="rounded border border-border-strong bg-bg-sunken px-1.5 py-0.5 font-mono text-xs text-text">Ctrl+Space</kbd> anywhere and speak.
        </p>
      </div>
    </div>
  );
}
