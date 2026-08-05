import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Plus, Trash2, KeyRound, Check, X, RefreshCw, ChevronRight } from "lucide-react";
import type { MainWindowApi } from "../../../shared/api";
import type { DictionaryEntry, Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import { MODEL_CATALOG } from "../../../shared/models";
import { ENGINE_OPTIONS } from "../../../shared/engines";
import type { UpdateState } from "../../../shared/updates";
import { INITIAL_UPDATE_STATE, describeUpdateState } from "../../../shared/updates";
import { Badge, Button, Card, Field, HotkeyCapture, Section, formatBytes } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * Settings in four groups with a sub-nav, rather than one undifferentiated
 * column. Timing values that only matter when something is wrong live behind
 * an Advanced disclosure per group: the app stays feature-rich without
 * charging every user the cost of reading past options they will never touch.
 */

const WHISPER_MODELS = MODEL_CATALOG.filter((model) => model.engine === "whisper-cpp");

const GROUPS = [
  { id: "capture", label: "Capture" },
  { id: "transcription", label: "Transcription" },
  { id: "delivery", label: "Delivery" },
  { id: "text", label: "Text" }
] as const;

const inputClass =
  "w-full rounded-md border border-border bg-bg-sunken px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-border-focus focus:outline-none";

function Toggle({
  checked,
  label,
  hint,
  onChange
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly hint?: string;
  readonly onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-0.5 accent-[var(--color-accent)]"
      />
      <span className="min-w-0">
        <span className="block text-sm text-text">{label}</span>
        {hint !== undefined && (
          <span className="block text-sm leading-snug text-text-muted">{hint}</span>
        )}
      </span>
    </label>
  );
}

/**
 * Collapsed by default. What is inside is reachable, not absent: hiding a
 * setting entirely is what forced these four values to be unreachable before.
 */
function Advanced({ children }: { readonly children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 transition-transform duration-fast", open && "rotate-90")}
          aria-hidden="true"
        />
        Advanced
      </Button>
      {open && <div className="mt-3 flex flex-col gap-3 border-l-2 border-border pl-4">{children}</div>}
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  unit,
  onCommit
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly onCommit: (next: number) => void;
}): JSX.Element {
  return (
    <Field label={label} hint={hint} inline>
      <span className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(event) => {
            const next = Number(event.target.value);
            // Out-of-range values are rejected by the schema, so clamping
            // here keeps the input from silently doing nothing.
            if (Number.isFinite(next)) onCommit(Math.min(max, Math.max(min, Math.round(next))));
          }}
          className="w-24 rounded-md border border-border bg-bg-sunken px-2 py-1 text-right font-mono text-sm text-text focus:border-border-focus focus:outline-none"
          data-numeric
        />
        <span className="text-xs text-text-muted">{unit}</span>
      </span>
    </Field>
  );
}

export function SettingsView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [group, setGroup] = useState<(typeof GROUPS)[number]["id"]>("capture");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyStored, setKeyStored] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyEditing, setKeyEditing] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
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
          Changes apply immediately. Nothing here needs a restart.
        </p>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border p-3"
          aria-label="Settings sections"
        >
          {GROUPS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-current={group === entry.id ? "true" : undefined}
              onClick={() => {
                setGroup(entry.id);
              }}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-fast",
                group === entry.id
                  ? "bg-surface font-medium text-text"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex max-w-2xl flex-col gap-8">
            {group === "capture" && (
              <>
                <Section
                  title="Keys"
                  description="Re-registered at runtime. Escape cancels a capture either way."
                >
                  <Card>
                    <div className="flex flex-col gap-3">
                      <Field label="Hold to record" hint="Hold, speak, release." inline>
                        <HotkeyCapture
                          label="hold to record key"
                          accelerator={settings.pttAccelerator}
                          onChange={(pttAccelerator) => {
                            update({ pttAccelerator });
                          }}
                        />
                      </Field>
                      <Field
                        label="Toggle capture"
                        hint="Press once to start, once to stop."
                        inline
                      >
                        <HotkeyCapture
                          label="toggle capture key"
                          accelerator={settings.toggleAccelerator}
                          onChange={(toggleAccelerator) => {
                            update({ toggleAccelerator });
                          }}
                        />
                      </Field>
                    </div>
                  </Card>
                </Section>

                <Section
                  title="Microphone"
                  description="Persisted by device. Windows rotates device IDs across reboots, so a label fallback keeps the choice stable."
                >
                  <select
                    aria-label="Microphone device"
                    value={selectedDeviceId ?? ""}
                    onChange={(event) => {
                      const deviceId = event.target.value;
                      setSelectedDeviceId(deviceId);
                      api.devices.setDevice(deviceId);
                    }}
                    className={inputClass}
                  >
                    {devices.length === 0 && <option value="">No microphones found</option>}
                    {devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>

                  <Advanced>
                    <NumberField
                      label="Shortest capture"
                      hint="Captures under this are discarded, so a mistyped key does not paste."
                      value={settings.minCaptureMs}
                      min={100}
                      max={5000}
                      unit="ms"
                      onCommit={(minCaptureMs) => {
                        update({ minCaptureMs });
                      }}
                    />
                    <NumberField
                      label="Longest capture"
                      hint="A stuck key is force-stopped after this."
                      value={settings.maxCaptureMs}
                      min={5000}
                      max={600000}
                      unit="ms"
                      onCommit={(maxCaptureMs) => {
                        update({ maxCaptureMs });
                      }}
                    />
                    <NumberField
                      label="Pre-roll"
                      hint="Audio kept from before the key went down, so an early first word survives."
                      value={settings.prerollMs}
                      min={0}
                      max={1000}
                      unit="ms"
                      onCommit={(prerollMs) => {
                        update({ prerollMs });
                      }}
                    />
                  </Advanced>
                </Section>

                <Section
                  title="Sounds"
                  description="A short chime when a capture starts and ends."
                >
                  <Toggle
                    checked={settings.captureSounds}
                    label="Play capture sounds"
                    hint="Confirms the microphone opened and closed without looking at the screen."
                    onChange={(captureSounds) => {
                      update({ captureSounds });
                    }}
                  />
                  <Advanced>
                    <NumberField
                      label="Sound volume"
                      hint="0 is silent, 100 is full volume."
                      value={Math.round(settings.captureSoundVolume * 100)}
                      min={0}
                      max={100}
                      unit="%"
                      onCommit={(percent) => {
                        update({ captureSoundVolume: percent / 100 });
                      }}
                    />
                  </Advanced>
                </Section>

                <Section
                  title="Capture panel"
                  description="The floating panel that appears while you dictate."
                >
                  <Toggle
                    checked={settings.liveTranscription}
                    label="Show a live transcript while speaking"
                    hint="Re-transcribes what you have said so far every second or so, so you can check a long dictation as you go. Off by default: it costs extra CPU, and on a slower machine that competes with the transcription that actually gets pasted."
                    onChange={(liveTranscription) => {
                      update({ liveTranscription });
                    }}
                  />
                  <Advanced>
                    <NumberField
                      label="Live transcript interval"
                      hint="How often to re-transcribe while listening. Longer is cheaper."
                      value={settings.liveTranscriptionIntervalMs}
                      min={400}
                      max={10000}
                      unit="ms"
                      onCommit={(liveTranscriptionIntervalMs) => {
                        update({ liveTranscriptionIntervalMs });
                      }}
                    />
                  </Advanced>
                </Section>
              </>
            )}

            {group === "transcription" && (
              <>
                <Section
                  title="Engine"
                  description="What turns your audio into text. Local engines keep it on this machine."
                >
                  <div className="flex flex-col gap-2">
                    {ENGINE_OPTIONS.map((option) => {
                      const active = settings.engine.primary === option.id;
                      return (
                        <label
                          key={option.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-fast",
                            active
                              ? "border-accent bg-accent-soft"
                              : "border-border hover:bg-surface-hover"
                          )}
                        >
                          <input
                            type="radio"
                            name="engine"
                            value={option.id}
                            checked={active}
                            onChange={() => {
                              update({
                                engine: { primary: option.id, fallback: settings.engine.fallback }
                              });
                            }}
                            className="mt-0.5 accent-[var(--color-accent)]"
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 text-sm font-medium text-text">
                              {option.displayName}
                              <Badge tone={option.kind === "cloud" ? "warning" : "neutral"}>
                                {option.kind}
                              </Badge>
                            </span>
                            <span className="block text-sm leading-snug text-text-muted">
                              {option.hint}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Section>

                {settings.engine.primary === "whisper-cpp" && (
                  <Section
                    title="Whisper model"
                    description="Bigger is more accurate and slower. Download it in Models first; the engine reports what is missing."
                  >
                    <select
                      aria-label="Whisper model"
                      value={settings.whisperModelId}
                      onChange={(event) => {
                        update({ whisperModelId: event.target.value });
                      }}
                      className={inputClass}
                    >
                      {WHISPER_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} ({formatBytes(model.bytes)})
                        </option>
                      ))}
                    </select>
                  </Section>
                )}

                <Section
                  title="OpenRouter API key"
                  description="Stored encrypted with Windows DPAPI. The raw key never crosses back to this window."
                >
                  {keyEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        aria-label="OpenRouter API key"
                        value={keyInput}
                        onChange={(event) => {
                          setKeyInput(event.target.value);
                          setKeyMessage(null);
                        }}
                        placeholder="sk-or-v1-..."
                        className={cn(inputClass, "font-mono")}
                      />
                      <Button
                        variant="primary"
                        onClick={saveKey}
                        disabled={keyInput.trim().length === 0}
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" /> Save
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setKeyEditing(false);
                          setKeyInput("");
                          setKeyMessage(null);
                        }}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-sm text-text">
                        <KeyRound className="h-4 w-4 text-text-muted" aria-hidden="true" />
                        {keyConfigured
                          ? keyStored
                            ? "A key is stored"
                            : "Configured via OPENROUTER_API_KEY"
                          : "No API key configured"}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setKeyEditing(true);
                            setKeyMessage(null);
                          }}
                        >
                          {keyStored ? "Replace key" : "Add key"}
                        </Button>
                        {keyStored && (
                          <Button variant="danger" onClick={clearKey}>
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {keyMessage !== null && <p className="text-sm text-text-muted">{keyMessage}</p>}
                </Section>
              </>
            )}

            {group === "delivery" && (
              <>
                <Section
                  title="Pasting"
                  description="How the transcript reaches the window you were working in."
                >
                  <Toggle
                    checked={settings.restoreClipboard}
                    label="Restore the clipboard after a paste"
                    hint="Delivery goes through the clipboard, so this puts back whatever you had copied."
                    onChange={(restoreClipboard) => {
                      update({ restoreClipboard });
                    }}
                  />
                  <Advanced>
                    <NumberField
                      label="Restore delay"
                      hint="Wait before restoring, so a slow application finishes reading the clipboard first."
                      value={settings.restoreClipboardDelayMs}
                      min={0}
                      max={5000}
                      unit="ms"
                      onCommit={(restoreClipboardDelayMs) => {
                        update({ restoreClipboardDelayMs });
                      }}
                    />
                  </Advanced>
                </Section>

                <Section title="Startup" description="Struq Voice lives in the tray.">
                  <Toggle
                    checked={settings.autostart}
                    label="Start with Windows"
                    hint="Launches hidden to the tray, so the key works from login."
                    onChange={(autostart) => {
                      update({ autostart });
                    }}
                  />
                </Section>

                <Section title="Updates" description={`Currently on version ${currentVersion}.`}>
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={cn(
                        "text-sm",
                        updateState.phase === "refused" ? "text-danger" : "text-text-muted"
                      )}
                    >
                      {describeUpdateState(updateState)}
                    </span>
                    {updateState.phase === "ready" ? (
                      <Button
                        variant="primary"
                        onClick={() => {
                          void api.updates.install();
                        }}
                      >
                        Restart and install
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={
                          updateState.phase === "checking" || updateState.phase === "downloading"
                        }
                        onClick={() => {
                          void api.updates.check().then(({ state }) => {
                            setUpdateState(state);
                          });
                        }}
                      >
                        <RefreshCw
                          className={cn(
                            "h-3.5 w-3.5",
                            (updateState.phase === "checking" ||
                              updateState.phase === "downloading") &&
                              "animate-spin"
                          )}
                          aria-hidden="true"
                        />
                        Check for updates
                      </Button>
                    )}
                  </div>
                  {updateState.phase === "refused" && (
                    // A refused update is not a quiet morning: someone served
                    // bytes that did not come from the release key. Say so.
                    <p className="text-sm text-danger">
                      Nothing was installed. The download did not match the release
                      signature, so it was discarded.
                    </p>
                  )}
                </Section>
              </>
            )}

            {group === "text" && (
              <>
                <Section
                  title="Cleanup"
                  description="Applied to every transcript before it is delivered."
                >
                  <Toggle
                    checked={settings.post.removeFillers}
                    label='Remove fillers like "um" and "uh"'
                    onChange={(removeFillers) => {
                      update({ post: { ...settings.post, removeFillers } });
                    }}
                  />
                  <Toggle
                    checked={settings.post.addTrailingPunctuation}
                    label="Add trailing punctuation"
                    hint="Ends a transcript with a full stop when it has none."
                    onChange={(addTrailingPunctuation) => {
                      update({ post: { ...settings.post, addTrailingPunctuation } });
                    }}
                  />
                </Section>

                <Section
                  title="Dictionary"
                  description={'Fix what the model reliably gets wrong. "Struck" becomes "Struq".'}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      aria-label="Replace this"
                      value={fromText}
                      onChange={(event) => {
                        setFromText(event.target.value);
                      }}
                      placeholder="Heard as"
                      className={inputClass}
                    />
                    <input
                      type="text"
                      aria-label="Replace with"
                      value={toText}
                      onChange={(event) => {
                        setToText(event.target.value);
                      }}
                      placeholder="Should be"
                      className={inputClass}
                    />
                    <Button
                      variant="secondary"
                      onClick={addDictionaryEntry}
                      disabled={fromText.trim().length === 0}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
                    </Button>
                  </div>
                  {settings.post.dictionary.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {settings.post.dictionary.map((entry, index) => (
                        <div
                          key={`${entry.from}-${String(index)}`}
                          className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
                        >
                          <span className="text-sm text-text">
                            <span className="font-mono">{entry.from}</span>
                            <span className="mx-2 text-text-muted">&rarr;</span>
                            <span className="font-mono">{entry.to}</span>
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${entry.from}`}
                            onClick={() => {
                              removeDictionaryEntry(index);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
