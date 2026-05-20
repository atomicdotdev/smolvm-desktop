import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Download,
  File as FileIcon,
  Folder,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

interface FileContent {
  text: string | null;
  binary: boolean;
  size: number;
}

export function FilesTab({ name, running }: { name: string; running: boolean }) {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadDir = useCallback(
    async (p: string) => {
      setLoading(true);
      setError(null);
      try {
        const list = await invoke<FileEntry[]>("list_files", { name, path: p });
        setEntries(list);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [name],
  );

  useEffect(() => {
    if (running) loadDir(path);
  }, [path, running, loadDir]);

  const clearSelection = () => {
    setSelected(null);
    setContent(null);
    setDraft(null);
  };

  const openEntry = async (entry: FileEntry) => {
    if (entry.is_dir) {
      clearSelection();
      setPath(entry.path);
      return;
    }

    setSelected(entry);
    setContent(null);
    setDraft(null);
    try {
      const c = await invoke<FileContent>("read_file", { name, path: entry.path });
      setContent(c);
      if (c.binary) return;
      setDraft(c.text ?? "");
    } catch (e) {
      setError(String(e));
    }
  };

  const goUp = () => {
    if (path === "/" || path === "") return;
    const parent = path.replace(/\/[^/]+\/?$/, "") || "/";
    setPath(parent);
    clearSelection();
  };

  const saveDraft = async () => {
    if (!selected || draft === null) return;
    setSaving(true);
    setError(null);
    try {
      await invoke("write_file", {
        name,
        path: selected.path,
        content: draft,
      });
      await loadDir(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const uploadHere = async () => {
    const hostPath = await openDialog({ multiple: false });
    if (typeof hostPath !== "string") return;
    const fileName = hostPath.split("/").pop() ?? "upload";
    const vmPath = path.endsWith("/") ? path + fileName : `${path}/${fileName}`;
    try {
      await invoke("upload_file", { name, hostPath, vmPath });
      await loadDir(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const downloadSelected = async () => {
    if (!selected) return;
    const hostPath = await saveDialog({ defaultPath: selected.name });
    if (typeof hostPath !== "string") return;
    try {
      await invoke("download_file", {
        name,
        vmPath: selected.path,
        hostPath,
      });
    } catch (e) {
      setError(String(e));
    }
  };

  if (!running) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
        Start the machine to browse its filesystem.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-2 text-sm">
        <button
          onClick={goUp}
          disabled={path === "/"}
          title="Up"
          className="rounded p-1 hover:bg-bg-card disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <Breadcrumbs path={path} onNavigate={setPath} />
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => loadDir(path)}
            title="Refresh"
            className="rounded p-1 hover:bg-bg-card"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={uploadHere}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-card px-2 py-1 text-xs hover:bg-bg-card/70"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-stopped/40 bg-stopped/10 px-4 py-2 text-sm text-stopped">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-80 shrink-0 overflow-auto border-r border-border">
          <FileList
            entries={entries}
            loading={loading}
            selectedPath={selected?.path ?? null}
            onOpen={openEntry}
          />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {selected ? (
            <FilePreview
              entry={selected}
              content={content}
              draft={draft}
              onDraftChange={setDraft}
              saving={saving}
              onSave={saveDraft}
              onDownload={downloadSelected}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
              Select a file to preview.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileList({
  entries,
  loading,
  selectedPath,
  onOpen,
}: {
  entries: FileEntry[];
  loading: boolean;
  selectedPath: string | null;
  onOpen: (e: FileEntry) => void;
}) {
  if (entries.length === 0 && !loading) {
    return <div className="p-4 text-sm text-fg-muted">Empty directory</div>;
  }
  return (
    <ul className="py-1">
      {entries.map((e) => (
        <FileRow
          key={e.path}
          entry={e}
          selected={selectedPath === e.path}
          onOpen={() => onOpen(e)}
        />
      ))}
    </ul>
  );
}

function FileRow({
  entry,
  selected,
  onOpen,
}: {
  entry: FileEntry;
  selected: boolean;
  onOpen: () => void;
}) {
  const Icon = entry.is_dir ? Folder : FileIcon;
  return (
    <li>
      <button
        onClick={onOpen}
        className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-bg-card ${
          selected ? "bg-accent/20" : ""
        }`}
      >
        <Icon
          className={`h-4 w-4 shrink-0 ${entry.is_dir ? "text-accent" : "text-fg-muted"}`}
        />
        <span className="truncate">{entry.name}</span>
        {!entry.is_dir && (
          <span className="ml-auto text-xs text-fg-muted">
            {formatSize(entry.size)}
          </span>
        )}
      </button>
    </li>
  );
}

function Breadcrumbs({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (p: string) => void;
}) {
  const parts = path.split("/").filter(Boolean);
  return (
    <div className="flex items-center gap-1 overflow-x-auto font-mono text-xs text-fg-muted">
      <button onClick={() => onNavigate("/")} className="hover:text-fg">
        /
      </button>
      {parts.map((part, i) => {
        const sub = "/" + parts.slice(0, i + 1).join("/");
        return (
          <span key={sub} className="flex items-center gap-1">
            <button
              onClick={() => onNavigate(sub)}
              className="hover:text-fg"
            >
              {part}
            </button>
            {i < parts.length - 1 && <span>/</span>}
          </span>
        );
      })}
    </div>
  );
}

function FilePreview({
  entry,
  content,
  draft,
  onDraftChange,
  saving,
  onSave,
  onDownload,
}: {
  entry: FileEntry;
  content: FileContent | null;
  draft: string | null;
  onDraftChange: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  onDownload: () => void;
}) {
  const dirty = content && !content.binary && draft !== content.text;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-2">
        <div className="flex-1 truncate font-mono text-xs text-fg-muted">
          {entry.path}
        </div>
        <span className="text-xs text-fg-muted">{formatSize(entry.size)}</span>
        <button
          onClick={onDownload}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-card px-2 py-1 text-xs hover:bg-bg-card/70"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
        {content && !content.binary && (
          <button
            onClick={onSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <PreviewBody
          content={content}
          draft={draft}
          onDraftChange={onDraftChange}
        />
      </div>
      {content && !content.binary && entry.size > 1024 * 1024 && (
        <div className="border-t border-border bg-bg px-4 py-1.5 text-xs text-starting">
          Preview truncated to first 1 MiB. Saving will overwrite the full file with what
          you see here — download instead if you need to preserve the tail.
        </div>
      )}
    </>
  );
}

function PreviewBody({
  content,
  draft,
  onDraftChange,
}: {
  content: FileContent | null;
  draft: string | null;
  onDraftChange: (v: string) => void;
}) {
  if (content === null) {
    return <div className="p-4 text-sm text-fg-muted">Loading…</div>;
  }
  if (content.binary) {
    return (
      <div className="p-4 text-sm text-fg-muted">
        Binary file ({formatSize(content.size)}). Download to inspect.
      </div>
    );
  }
  return (
    <textarea
      value={draft ?? ""}
      onChange={(e) => onDraftChange(e.target.value)}
      spellCheck={false}
      className="h-full w-full resize-none bg-bg-term p-3 font-mono text-xs leading-5 text-fg-term outline-none"
    />
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
