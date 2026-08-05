import { useEffect, useState } from "react";
import type { JSX } from "react";
import {
  Plus,
  Trash2,
  KeyRound,
  Check,
  X,
  Keyboard,
  Mic,
  Sparkles,
  RefreshCw
} from "lucide-react";
import type { MainWindowApi } from "../../../shared/api";
import type { DictionaryEntry, Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import { MODEL_CATALOG } from "../../../shared/models";
import { domEventToAccelerator } from "../../../shared/hotkeys";
import type { UpdateState } from "../../../shared/updates";
import { INITIAL_UPDATE_STATE, describeUpdateState } from "../../../shared/updates";

const WHISPER_MODELS = MODEL_CATALOG.filter((model) => model.engine === "whisper-cpp");

const formatModelBytes = (bytes: number): string =>
  bytes < 1024 * 1024 * 1024
    ? `${String(Math.round(bytes / (1024 * 1024)))} MB`
    : `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;

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
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyStored, setKeyStored] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyEditing, setKeyEditing] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [capturingPtt, setCapturingPtt] = useState(false);
  const [capturingToggle, setCapturingToggle] = useState(false);
  const [hotkeyMessage, setHotkeyMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<readonly { deviceId: string; label: string }[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>(INITIAL_UPDATE_STATE);
  const [currentVersion, setCurrentVersion] = useState("");

  useEffect(() => {
    void api.updates.get().then(({ state, currentVersion: version }) => {
      setUpdateState(state);
      setCurrentVersion(version);
    });
    // Downloads report progress from main, so the panel follows the broadcast
    // rather than polling.
    return api.updates.onChange((state) => {
      setUpdateState(state);
    });
  }, [api]);

  useEffect(() => {
    void api.devices.list().then((result) => {
      setDevices(result.devices);
      setSelectedDeviceId(result.currentDeviceId ?? result.devices[0]?.deviceId ?? null);
    });
  }, [api]);

  useEffect(() => {
    void api.settings.get().then(({ settings: loaded }) => {
      setSettings(loaded);
    });
    return api.settings.onChange((changed) => {
      setSettings(changed);
    });
  }, [api]);

  useEffect(() => {
    void api.openRouterKey.status().then((status) => {
      setKeyConfigured(status.configured);
      setKeyStored(status.stored);
    });
  }, [api, keyEditing]);

  const update = (patch: Partial<Settings>): void => {
    void api.settings.update(patch).then(({ settings: updated }) => {
      setSettings(updated);
    });
  };

  const saveKey = (): void => {
    const key = keyInput.trim();
    if (key.length === 0) return;
    void api.openRouterKey.set(key).then((result) => {
      if (result.ok) {
        setKeyMessage("API key saved.");
        setKeyEditing(false);
        setKeyInput("");
        void api.openRouterKey.status().then((status) => {
          setKeyConfigured(status.configured);
          setKeyStored(status.stored);
        });
      } else {
        setKeyMessage(result.message ?? "Could not save the API key.");
      }
    });
  };

  const clearKey = (): void => {
    void api.openRouterKey.clear().then((result) => {
      if (result.ok) {
        setKeyMessage("API key removed.");
        setKeyConfigured(false);
        setKeyStored(false);
      } else {
        setKeyMessage(result.message ?? "Could not clear the API key.");
      }
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

          {settings.engine.primary === "whisper-cpp" && (
            <Section title="Whisper model">
              <label className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                <select
                  value={settings.whisperModelId}
                  onChange={(event) => {
                    update({ whisperModelId: event.target.value });
                  }}
                  className="w-full rounded-md border border-border bg-bg-sunken px-3 py-1.5 text-sm text-text focus:border-border-focus focus:outline-none"
                >
                  {WHISPER_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({formatModelBytes(model.bytes)})
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-text-muted">
                Bigger is more accurate and slower. Download the model in Models
                first; the engine reports what is missing.
              </p>
            </Section>
          )}

          <Section title="OpenRouter API key">
            <p className="text-xs text-text-muted">
              Stored encrypted with Windows DPAPI. The raw key never leaves the machine.
            </p>
            {keyEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={keyInput}
                  onChange={(event) => {
                    setKeyInput(event.target.value);
                    setKeyMessage(null);
                  }}
                  placeholder="sk-or-v1-..."
                  className="w-full rounded-md border border-border bg-bg-sunken px-3 py-1.5 font-mono text-sm text-text placeholder:text-text-muted focus:border-border-focus focus:outline-none"
                />
                <button
                  type="button"
                  onClick={saveKey}
                  disabled={keyInput.trim().length === 0}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-solid px-3 py-1.5 text-sm font-medium text-text-inverse transition-colors duration-fast hover:bg-accent-solid-hover disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" /> Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setKeyEditing(false);
                    setKeyInput("");
                    setKeyMessage(null);
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-muted transition-colors duration-fast hover:bg-surface-hover hover:text-text"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-sm text-text">
                  <KeyRound className="h-4 w-4 text-accent-text" aria-hidden="true" />
                  {keyConfigured
                    ? keyStored
                      ? "A key is stored"
                      : "Configured via OPENROUTER_API_KEY"
                    : "No API key configured"}
                </span>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setKeyEditing(true);
                      setKeyMessage(null);
                    }}
                    className="rounded-md bg-accent-solid px-3 py-1.5 text-sm font-medium text-text-inverse transition-colors duration-fast hover:bg-accent-solid-hover"
                  >
                    {keyStored ? "Replace key" : "Add key"}
                  </button>
                  {keyStored && (
                    <button
                      type="button"
                      onClick={clearKey}
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted transition-colors duration-fast hover:border-danger-soft hover:bg-danger-soft hover:text-danger"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}
            {keyMessage !== null && (
              <p className="text-xs text-text-muted">{keyMessage}</p>
            )}
          </Section>

          <Section title="Microphone">
            <label className="flex items-center gap-2">
              <Mic className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
              <select
                value={selectedDeviceId ?? ""}
                onChange={(event) => {
                  const deviceId = event.target.value;
                  setSelectedDeviceId(deviceId);
                  api.devices.setDevice(deviceId);
                }}
                className="w-full rounded-md border border-border bg-bg-sunken px-3 py-1.5 text-sm text-text focus:border-border-focus focus:outline-none"
              >
                {devices.length === 0 && <option value="">No microphones found</option>}
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-text-muted">
              Persisted by device. Windows rotates device IDs across reboots, so a
              label fallback keeps the choice stable.
            </p>
          </Section>

          <Section title="Capture hotkey">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-text">Hold to record</span>
              <div className="flex items-center gap-2">
                <kbd className="rounded-md border border-border-strong bg-bg-sunken px-3 py-1.5 font-mono text-sm text-text">
                  {capturingPtt ? "Press a chord..." : settings.pttAccelerator}
                </kbd>
                <button
                  type="button"
                  onClick={() => {
                    setCapturingPtt((current) => !current);
                    setCapturingToggle(false);
                    setHotkeyMessage(null);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted transition-colors duration-fast hover:bg-surface-hover hover:text-text"
                >
                  {capturingPtt ? "Cancel" : "Change"}
                </button>
              </div>
            </div>
            {capturingPtt && (
              <button
                type="button"
                autoFocus
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-accent bg-accent-soft px-3 py-2 text-sm text-accent-text focus:outline-none"
                onKeyDown={(event) => {
                  event.preventDefault();
                  const accelerator = domEventToAccelerator(event);
                  if (accelerator === null) return;
                  setCapturingPtt(false);
                  update({ pttAccelerator: accelerator });
                }}
              >
                <Keyboard className="h-4 w-4" aria-hidden="true" />
                Click, then press the new hold-to-record chord
              </button>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm text-text">Toggle capture</span>
              <div className="flex items-center gap-2">
                <kbd className="rounded-md border border-border-strong bg-bg-sunken px-3 py-1.5 font-mono text-sm text-text">
                  {capturingToggle ? "Press a chord..." : settings.toggleAccelerator}
                </kbd>
                <button
                  type="button"
                  onClick={() => {
                    setCapturingToggle((current) => !current);
                    setCapturingPtt(false);
                    setHotkeyMessage(null);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted transition-colors duration-fast hover:bg-surface-hover hover:text-text"
                >
                  {capturingToggle ? "Cancel" : "Change"}
                </button>
              </div>
            </div>
            {capturingToggle && (
              <button
                type="button"
                autoFocus
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-accent bg-accent-soft px-3 py-2 text-sm text-accent-text focus:outline-none"
                onKeyDown={(event) => {
                  event.preventDefault();
                  const accelerator = domEventToAccelerator(event);
                  if (accelerator === null) return;
                  setCapturingToggle(false);
                  update({ toggleAccelerator: accelerator });
                }}
              >
                <Keyboard className="h-4 w-4" aria-hidden="true" />
                Click, then press the new toggle chord
              </button>
            )}
            <p className="text-xs text-text-muted">
              Re-registers at runtime, no restart needed. Escape cancels a capture either way.
            </p>
            {hotkeyMessage !== null && (
              <p className="text-xs text-danger">{hotkeyMessage}</p>
            )}
          </Section>

          <Section title="Delivery">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={settings.autostart}
                onChange={(event) => {
                  update({ autostart: event.target.checked });
                }}
                className="accent-[var(--color-accent)]"
              />
              <span className="text-sm text-text">
                Start Struq Voice with Windows
              </span>
            </label>
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

          <Section title="Updates">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-sm text-text">
                <RefreshCw
                  className={`h-4 w-4 shrink-0 text-accent-text ${
                    updateState.phase === "checking" || updateState.phase === "downloading"
                      ? "animate-spin"
                      : ""
                  }`}
                  aria-hidden="true"
                />
                Version {currentVersion}
              </span>
              <div className="flex shrink-0 gap-2">
                {updateState.phase === "ready" ? (
                  <button
                    type="button"
                    onClick={() => {
                      void api.updates.install();
                    }}
                    className="rounded-md bg-accent-solid px-3 py-1.5 text-sm font-medium text-text-inverse transition-colors duration-fast hover:bg-accent-solid-hover"
                  >
                    Restart and install
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={updateState.phase === "checking" || updateState.phase === "downloading"}
                    onClick={() => {
                      void api.updates.check().then(({ state }) => {
                        setUpdateState(state);
                      });
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted transition-colors duration-fast hover:bg-surface-hover hover:text-text disabled:opacity-50"
                  >
                    Check for updates
                  </button>
                )}
              </div>
            </div>
            <p
              className={`text-xs ${
                updateState.phase === "refused" ? "text-danger" : "text-text-muted"
              }`}
            >
              {describeUpdateState(updateState)}
            </p>
            {updateState.phase === "refused" && (
              // A refused update is not a quiet morning: someone served bytes
              // that did not come from the release key. Say so plainly.
              <p className="text-xs text-danger">
                Nothing was installed. The download did not match the release
                signature, so it was discarded.
              </p>
            )}
            {updateState.phase === "ready" && (
              <p className="text-xs text-text-muted">
                Struq Voice restarts to finish. It takes a few seconds.
              </p>
            )}
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
