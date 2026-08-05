import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { MainWindowApi } from "../../../shared/api";
import type { DictionaryEntry, Settings } from "../../../shared/settings";
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
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");

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

  const addDictionaryEntry = (): void => {
    const from = fromText.trim();
    const to = toText.trim();
    if (from.length === 0) return;
    const entry: DictionaryEntry = { from, to, matchCase: false, wholeWord: true };
    update({ post: { ...settings.post, dictionary: [...settings.post.dictionary, entry] } });
    setFromText("");
    setToText("");
  };

  const removeDictionaryEntry = (index: number): void => {
    const dictionary = settings.post.dictionary.filter((_entry, i) => i !== index);
    update({ post: { ...settings.post, dictionary } });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-serif text-2xl tracking-tight text-text">Settings</h1>
        <p className="mt-1 text-sm text-text-muted">
          Engine, hotkey, delivery and post-processing options. Changes apply immediately.
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

          <Section title="Dictionary">
            <p className="text-xs text-text-muted">
              "Struck" becomes "Struq", "tow ree" becomes "Tauri". Replaced before delivery.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={fromText}
                onChange={(event) => {
                  setFromText(event.target.value);
                }}
                placeholder="From"
                className="w-1/2 rounded-md border border-border bg-bg-sunken px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-border-focus focus:outline-none"
              />
              <input
                type="text"
                value={toText}
                onChange={(event) => {
                  setToText(event.target.value);
                }}
                placeholder="To"
                className="w-1/2 rounded-md border border-border bg-bg-sunken px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-border-focus focus:outline-none"
              />
              <button
                type="button"
                onClick={addDictionaryEntry}
                disabled={fromText.trim().length === 0}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-solid px-3 py-1.5 text-sm font-medium text-text-inverse transition-colors duration-fast hover:bg-accent-solid-hover disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
              </button>
            </div>
            {settings.post.dictionary.length > 0 && (
              <div className="flex flex-col gap-1">
                {settings.post.dictionary.map((entry, index) => (
                  <div
                    key={`${entry.from}-${String(index)}`}
                    className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2"
                  >
                    <span className="text-sm text-text">
                      <span className="font-mono">{entry.from}</span>
                      <span className="mx-2 text-text-muted">&rarr;</span>
                      <span className="font-mono">{entry.to}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${entry.from}`}
                      onClick={() => {
                        removeDictionaryEntry(index);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
