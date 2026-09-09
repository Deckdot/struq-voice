import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { MainWindowApi } from "../../../shared/api";
import type { NoteFilter, NoteRecord, NoteSummary } from "../../../shared/ipc";
import { Button, Select, TextInput } from "../components/ui";

const formatUpdated = (timestamp: number): string => new Date(timestamp).toLocaleString();

export function NotesView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [items, setItems] = useState<readonly NoteSummary[]>([]);
  const [selected, setSelected] = useState<NoteRecord | null>(null);
  const [filter, setFilter] = useState<NoteFilter>("active");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("Saved");
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = (): void => {
    void api.notes.list({ query, filter, limit: 100 }).then((result) => { setItems(result.items); });
  };

  useEffect(() => {
    refresh();
    return api.notes.onChange(() => { refresh(); });
  }, [api, query, filter]);

  const open = (id: number): void => {
    void api.notes.get(id).then((note) => {
      if (note === null) return;
      setSelected(note);
      setTitle(note.title);
      setBody(note.body);
      revision.current = 0;
      savedRevision.current = 0;
      setStatus("Saved");
    });
  };

  const scheduleSave = (nextTitle: string, nextBody: string): void => {
    revision.current += 1;
    const nextRevision = revision.current;
    setStatus("Unsaved");
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (nextTitle.trim().length === 0 && nextBody.trim().length === 0 && selected === null) {
        setStatus("Draft");
        return;
      }
      setStatus("Saving");
      const operation = selected === null
        ? api.notes.create({ title: nextTitle, body: nextBody })
        : api.notes.update(selected.id, { title: nextTitle, body: nextBody, titleIsManual: nextTitle.trim().length > 0 });
      void operation.then((note) => {
        if (nextRevision !== revision.current) return;
        if (note !== null) {
          setSelected(note);
          savedRevision.current = nextRevision;
          setStatus("Saved");
          refresh();
        }
      }).catch(() => { setStatus("Save failed"); });
    }, 400);
  };

  const createNew = (): void => {
    setSelected(null);
    setTitle("");
    setBody("");
    setStatus("Draft");
  };

  return (
    <div className="flex h-full min-h-0 bg-bg">
      <aside className="flex w-[264px] shrink-0 flex-col border-e border-border bg-surface/30 p-4">
        <div className="flex items-center gap-2">
          <TextInput value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder="Search notes" />
          <Button variant="primary" size="sm" onClick={createNew}>New</Button>
        </div>
        <Select className="mt-3" value={filter} onChange={(event) => { setFilter(event.target.value as NoteFilter); }}>
          <option value="active">Notes</option>
          <option value="archived">Archived</option>
          <option value="trash">Trash</option>
        </Select>
        <div className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => { open(item.id); }} className="w-full rounded-md border border-transparent px-3 py-2 text-start hover:border-border hover:bg-surface">
              <div className="truncate text-sm font-medium text-text">{item.title || "Untitled note"}</div>
              <div className="mt-1 line-clamp-2 text-xs text-text-muted">{item.preview}</div>
              <div className="mt-1 text-2xs text-text-muted">{formatUpdated(item.updatedAt)}</div>
            </button>
          ))}
          {items.length === 0 && <p className="px-2 py-6 text-sm text-text-muted">No notes yet.</p>}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col p-8">
        <div className="mx-auto flex h-full w-full max-w-[900px] flex-col">
          <input className="border-0 bg-transparent text-3xl font-semibold text-text outline-none placeholder:text-text-muted" value={title} onChange={(event) => { setTitle(event.target.value); scheduleSave(event.target.value, body); }} placeholder="Untitled note" />
          <div className="mt-2 flex items-center justify-between text-xs text-text-muted"><span>{status}</span><span>{selected ? `Updated ${formatUpdated(selected.updatedAt)}` : "New note"}</span></div>
          <textarea className="mt-6 min-h-0 flex-1 resize-none border-0 bg-transparent text-base leading-7 text-text outline-none placeholder:text-text-muted" value={body} onChange={(event) => { setBody(event.target.value); scheduleSave(title, event.target.value); }} placeholder="Start writing..." />
          {selected !== null && <div className="flex items-center gap-2 border-t border-border pt-3"><Button variant="secondary" size="sm" onClick={() => { void api.notes.setPinned(selected.id, selected.pinnedAt === null); }}> {selected.pinnedAt === null ? "Pin" : "Unpin"}</Button><Button variant="secondary" size="sm" onClick={() => { void api.notes.setState(selected.id, selected.archivedAt === null ? "archived" : "active"); }}> {selected.archivedAt === null ? "Archive" : "Restore"}</Button><Button variant="secondary" size="sm" onClick={() => { void api.notes.export(selected.id).then((result) => { if (result.ok && result.markdown !== undefined) api.clipboard.copy(result.markdown); }); }}>Copy Markdown</Button><Button variant="danger" size="sm" onClick={() => { void api.notes.setState(selected.id, "trash").then(() => { createNew(); }); }}>Trash</Button></div>}
        </div>
      </section>
    </div>
  );
}
