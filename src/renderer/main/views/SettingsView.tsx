import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { MainWindowApi } from "../../../shared/api";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";

const ENGINE_OPTIONS: readonly { id: string; label: string; hint: string }[] = [
  {
    id: "mock",
    label: "Mock (test)",
    hint: "Deterministic fake transcriptions, for development only."
  },
  {
    id: "openrouter",
    label: "OpenRouter Whisper",
    hint: "Cloud transcription. Accurate, needs an API key, audio leaves the machine."
  },
  {
    id: "parakeet",
    label: "Parakeet TDT",
    hint: "Local. 25 European languages, fastest path once the model is downloaded."
  },
  {
    id: "whisper-cpp",
    label: "Whisper.cpp",
    hint: "Local GPU. Handles non-European languages and poor recordings."
  }
];

const HOTKEY_LABEL = "Ctrl+Space";

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-medium text-text">{title}</h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function SettingsView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void api.settings.get().then(({ settings: loaded }) => {
      setSettings(loaded);
    });
    return api.settings.onChange((changed) => {
      setSettings(changed);
    });
  }, [api]);

  const update = (patch: Partial<Settings>): void => {
    void api.settings.update(patch).then(({ settings: updated }) => {
      setSettings(updated);
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-serif text-2xl tracking-tight text-text">Settings</h1>
        <p className="mt-1 text-sm text-text-muted">
          Engine, hotkey and delivery options. Changes apply immediately.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex max-w-2xl flex-col gap-4">
          <Section title="Engine">
            <div className="flex flex-col gap-2">
              {ENGINE_OPTIONS.map((option) => {
                const active = settings.engine.primary === option.id;
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-fast ${
                      active
                        ? "border-accent bg-accent-soft"
                        : "border-border hover:bg-surface-hover"
                    }`}
                  >
                    <input
                      type="radio"
                      name="engine"
                      value={option.id}
                      checked={active}
                      onChange={() => {
                        update({ engine: { primary: option.id, fallback: settings.engine.fallback } });
                      }}
                      className="mt-0.5 accent-[var(--color-accent)]"
                    />
                    <span>
                      <span className="block text-sm font-medium text-text">{option.label}</span>
                      <span className="block text-xs text-text-muted">{option.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Section>

          <Section title="Capture hotkey">
            <div className="flex items-center gap-3">
              <kbd className="rounded-md border border-border-strong bg-bg-sunken px-3 py-1.5 text-sm text-text">
                {HOTKEY_LABEL}
              </kbd>
              <span className="text-xs text-text-muted">
                Hold to record, release to transcribe. Reassignment lands in a later slice.
              </span>
            </div>
          </Section>

          <Section title="Delivery">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={settings.restoreClipboard}
                onChange={(event) => {
                  update({ restoreClipboard: event.target.checked });
                }}
                className="accent-[var(--color-accent)]"
              />
              <span className="text-sm text-text">
                Restore the clipboard after a paste
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={settings.post.removeFillers}
                onChange={(event) => {
                  update({ post: { ...settings.post, removeFillers: event.target.checked } });
                }}
                className="accent-[var(--color-accent)]"
              />
              <span className="text-sm text-text">Remove fillers like "um" and "uh"</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={settings.post.addTrailingPunctuation}
                onChange={(event) => {
                  update({
                    post: { ...settings.post, addTrailingPunctuation: event.target.checked }
                  });
                }}
                className="accent-[var(--color-accent)]"
              />
              <span className="text-sm text-text">Add trailing punctuation</span>
            </label>
          </Section>
        </div>
      </div>
    </div>
  );
}
