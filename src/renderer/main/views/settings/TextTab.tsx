import { useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../../shared/api";
import type { DictionaryEntry, Settings } from "../../../../shared/settings";
import {
  Button,
  EmptyState,
  Field,
  InlineError,
  SettingsGroup,
  SettingsRow,
  Switch,
  TextInput
} from "../../components/ui";

/**
 * The Text settings tab: the small cleanups applied to every transcript,
 * and the dictionary of words Struq Voice should always fix.
 */
export interface TextTabProps {
  readonly api: MainWindowApi;
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
}

interface EditState {
  readonly index: number;
  readonly from: string;
  readonly to: string;
}

export function TextTab({ settings, update }: TextTabProps): JSX.Element {
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dictionary = settings.post.dictionary;

  const isDuplicate = (from: string, ignoreIndex = -1): boolean =>
    dictionary.some((entry, index) => index !== ignoreIndex && entry.from.toLowerCase() === from.toLowerCase());

  const addEntry = (): void => {
    const from = fromText.trim();
    const to = toText.trim();
    if (from.length === 0) return;
    if (isDuplicate(from)) {
      setError(`You already have a rule for "${from}".`);
      return;
    }
    const entry: DictionaryEntry = { from, to, matchCase: false, wholeWord: true };
    update({ post: { ...settings.post, dictionary: [...dictionary, entry] } });
    setFromText("");
    setToText("");
    setError(null);
  };

  const startEdit = (index: number): void => {
    const entry = dictionary[index];
    if (entry === undefined) return;
    setEditing({ index, from: entry.from, to: entry.to });
    setError(null);
  };

  const saveEdit = (): void => {
    if (editing === null) return;
    const from = editing.from.trim();
    const to = editing.to.trim();
    if (from.length === 0) return;
    if (isDuplicate(from, editing.index)) {
      setError(`You already have a rule for "${from}".`);
      return;
    }
    const next = dictionary.map((entry, index) =>
      index === editing.index ? { ...entry, from, to } : entry
    );
    update({ post: { ...settings.post, dictionary: next } });
    setEditing(null);
    setError(null);
  };

  const cancelEdit = (): void => {
    setEditing(null);
    setError(null);
  };

  const removeEntry = (index: number): void => {
    const next = dictionary.filter((_, i) => i !== index);
    update({ post: { ...settings.post, dictionary: next } });
    if (editing !== null && editing.index === index) {
      setEditing(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title="Cleanups"
        description="Applied to every transcript before it lands."
      >
        <SettingsRow
          label="Remove filler words"
          hint='Strips out the "um" and "uh" sounds that often sneak in. Turn off if you would rather keep them.'
          control={
            <Switch
              checked={settings.post.removeFillers}
              onChange={(removeFillers) => {
                update({ post: { ...settings.post, removeFillers } });
              }}
            />
          }
        />
        <SettingsRow
          label="Add a period at the end"
          hint="Adds a period when one is missing."
          control={
            <Switch
              checked={settings.post.addTrailingPunctuation}
              onChange={(addTrailingPunctuation) => {
                update({ post: { ...settings.post, addTrailingPunctuation } });
              }}
            />
          }
        />
        <SettingsRow
          label="Whitespace"
          hint="Always on. Trims and collapses extra spaces."
          control={<span className="text-2xs text-text-muted">Always on</span>}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Words to fix"
        description={`Whenever Struq Voice hears the word on the left, it replaces it with the word on the right. ${dictionary.length === 0 ? "You have not added any yet." : ""}`}
      >
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-end gap-2">
            <Field label="Heard as" inline className="flex-1">
              <TextInput
                value={fromText}
                onChange={(event) => {
                  setFromText(event.target.value);
                  setError(null);
                }}
                placeholder="struck"
              />
            </Field>
            <Icon icon="ph:arrow-right" className="mb-2 h-4 w-4 text-text-muted" aria-hidden="true" />
            <Field label="Should be" inline className="flex-1">
              <TextInput
                value={toText}
                onChange={(event) => {
                  setToText(event.target.value);
                }}
                placeholder="Struq"
              />
            </Field>
            <Button
              variant="secondary"
              size="md"
              onClick={addEntry}
              disabled={fromText.trim().length === 0}
            >
              <Icon icon="ph:plus" className="h-3.5 w-3.5" aria-hidden="true" />
              Add
            </Button>
          </div>
          {error !== null && <InlineError>{error}</InlineError>}
        </div>

        {dictionary.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState
              icon="ph:swap"
              title="No rules yet"
              body="Add a word Struq Voice keeps getting wrong. Common ones: company names, people's names, technical terms."
            />
          </div>
        ) : (
          <div className="flex flex-col">
            {dictionary.map((entry, index) => {
              if (editing !== null && editing.index === index) {
                return (
                  <div
                    key={`${entry.from}-${String(index)}`}
                    className="flex items-center gap-2 px-4 py-3"
                  >
                    <div className="flex-1">
                      <TextInput
                        value={editing.from}
                        onChange={(event) => {
                          setEditing({ ...editing, from: event.target.value });
                          setError(null);
                        }}
                      />
                    </div>
                    <Icon icon="ph:arrow-right" className="h-4 w-4 text-text-muted" aria-hidden="true" />
                    <div className="flex-1">
                      <TextInput
                        value={editing.to}
                        onChange={(event) => {
                          setEditing({ ...editing, to: event.target.value });
                        }}
                      />
                    </div>
                    <Button variant="primary" size="sm" onClick={saveEdit}>
                      <Icon icon="ph:check" className="h-3.5 w-3.5" aria-hidden="true" />
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                );
              }
              return (
                <div
                  key={`${entry.from}-${String(index)}`}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm text-text">
                      {entry.from}
                      <span className="mx-2 text-text-muted">→</span>
                      {entry.to}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit rule for ${entry.from}`}
                    onClick={() => {
                      startEdit(index);
                    }}
                  >
                    <Icon icon="ph:pencil-simple" className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove rule for ${entry.from}`}
                    onClick={() => {
                      removeEntry(index);
                    }}
                  >
                    <Icon icon="ph:trash" className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}
