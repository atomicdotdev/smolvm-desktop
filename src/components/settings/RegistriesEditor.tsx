import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/invoke";
import {
  EMPTY_CONFIG,
  RegistriesConfig,
  RegistryEntry,
  cloneConfig,
  equals as configsEqual,
  parse as parseRegistries,
  stringify as stringifyRegistries,
  suggestEnvVar,
} from "@/lib/registries-toml";

type View = "structured" | "raw";

/** Disable macOS/Safari autocorrect on identifier-ish inputs. */
const noAutoCorrect = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  autoComplete: "off",
} as const;

const HOST_PRESETS = ["docker.io", "ghcr.io", "gcr.io"] as const;

interface RegistriesEditorProps {
  /** Raw TOML text loaded from disk; "" if file doesn't exist. */
  initialText: string;
  /** Absolute path to the registries.toml file on disk, if known. */
  filePath: string | null;
  /** Initial load error (e.g. backend couldn't read the file). */
  loadError: string | null;
}

interface DiskState {
  text: string;
  parsed: RegistriesConfig;
  /** Whether the on-disk text round-trips cleanly through structured mode. */
  parsedClean: boolean;
}

function safeParse(text: string): {
  config: RegistriesConfig;
  error: string | null;
} {
  try {
    return { config: parseRegistries(text), error: null };
  } catch (e) {
    return { config: EMPTY_CONFIG, error: String(e) };
  }
}

export function RegistriesEditor({
  initialText,
  filePath,
  loadError,
}: RegistriesEditorProps) {
  // Initial parse — if the file on disk is malformed, fall back to Raw view.
  const initialParse = useMemo(() => safeParse(initialText), [initialText]);

  const [disk, setDisk] = useState<DiskState>(() => ({
    text: initialText,
    parsed: initialParse.config,
    parsedClean: initialParse.error === null,
  }));

  const [view, setView] = useState<View>(
    initialParse.error === null ? "structured" : "raw",
  );
  const [config, setConfig] = useState<RegistriesConfig>(() =>
    cloneConfig(initialParse.config),
  );
  const [rawText, setRawText] = useState<string>(initialText);
  const [rawParseError, setRawParseError] = useState<string | null>(null);

  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(loadError);

  // Pick up updates if the parent reloads from disk.
  useEffect(() => {
    const parsed = safeParse(initialText);
    setDisk({
      text: initialText,
      parsed: parsed.config,
      parsedClean: parsed.error === null,
    });
    setConfig(cloneConfig(parsed.config));
    setRawText(initialText);
    setRawParseError(null);
    setView(parsed.error === null ? "structured" : "raw");
    setSaveStatus(null);
    setSaveError(loadError);
  }, [initialText, loadError]);

  const structuredDirty = !configsEqual(config, disk.parsed);
  const rawDirty = rawText !== disk.text;
  const dirty = view === "structured" ? structuredDirty : rawDirty;

  /** Switch from Structured → Raw: serialize current config into rawText. */
  const switchToRaw = () => {
    setRawText(stringifyRegistries(config));
    setRawParseError(null);
    setView("raw");
  };

  /** Switch from Raw → Structured: try to parse rawText. */
  const switchToStructured = () => {
    const parsed = safeParse(rawText);
    if (parsed.error) {
      setRawParseError(parsed.error);
      return;
    }
    setConfig(parsed.config);
    setRawParseError(null);
    setView("structured");
  };

  const onSave = async () => {
    if (saving) return;
    setSaveError(null);
    setSaveStatus(null);

    let payload: string;
    let newConfig: RegistriesConfig;
    let newText: string;
    let parsedClean: boolean;

    if (view === "structured") {
      payload = stringifyRegistries(config);
      newConfig = cloneConfig(config);
      newText = payload;
      parsedClean = true;
    } else {
      const parsed = safeParse(rawText);
      if (parsed.error) {
        setRawParseError(parsed.error);
        setSaveError(`Can't save: ${parsed.error}`);
        return;
      }
      payload = rawText;
      newConfig = parsed.config;
      newText = rawText;
      parsedClean = true;
    }

    setSaving(true);
    try {
      await api.writeRegistries(payload);
      setDisk({ text: newText, parsed: newConfig, parsedClean });
      if (view === "raw") {
        setConfig(cloneConfig(newConfig));
      } else {
        setRawText(newText);
      }
      setSaveStatus("Saved.");
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const addRegistry = () => {
    setEditing({ kind: "add" });
  };

  const editRegistry = (host: string) => {
    const entry = config.registries.find((r) => r.host === host);
    if (!entry) return;
    setEditing({ kind: "edit", entry });
  };

  const removeRegistry = (host: string) => {
    setConfig((prev) => {
      const next = cloneConfig(prev);
      next.registries = next.registries.filter((r) => r.host !== host);
      if (next.defaultRegistry === host) {
        next.defaultRegistry = null;
      }
      return next;
    });
    setSaveStatus(null);
  };

  const upsertRegistry = (entry: RegistryEntry, originalHost: string | null) => {
    setConfig((prev) => {
      const next = cloneConfig(prev);
      if (originalHost === null) {
        // Add — disallow duplicates.
        if (next.registries.some((r) => r.host === entry.host)) {
          return prev;
        }
        next.registries.push(entry);
      } else {
        const idx = next.registries.findIndex((r) => r.host === originalHost);
        if (idx < 0) return prev;
        next.registries[idx] = entry;
      }
      return next;
    });
    setSaveStatus(null);
    setEditing(null);
  };

  const setDefault = (host: string | null) => {
    setConfig((prev) => ({
      ...cloneConfig(prev),
      defaultRegistry: host,
    }));
    setSaveStatus(null);
  };

  const knownHosts = new Set(config.registries.map((r) => r.host));
  const defaultIsOrphan =
    config.defaultRegistry !== null && !knownHosts.has(config.defaultRegistry);

  return (
    <div className="space-y-3 rounded-md border border-border bg-bg-card p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-fg-muted">
          Registry credentials and endpoints used by{" "}
          <span className="font-mono">smolvm pack push</span> /{" "}
          <span className="font-mono">pull</span>. Saved files are validated by
          smolvm on its next invocation — malformed configs surface as errors
          then.
        </p>
        <button
          onClick={view === "structured" ? switchToRaw : switchToStructured}
          className="shrink-0 rounded-md border border-border bg-bg px-2 py-1 text-xs hover:bg-bg-card/70"
          title={
            view === "structured"
              ? "Edit the file as raw TOML"
              : "Return to structured view"
          }
        >
          {view === "structured" ? "Raw TOML" : "Structured"}
        </button>
      </div>

      {view === "structured" && !disk.parsedClean && (
        <div className="rounded border border-starting/40 bg-starting/10 p-2 text-xs text-starting">
          The file on disk couldn{"’"}t be parsed cleanly; you{"’"}re
          editing a fresh structure. Saving will overwrite the file.
        </div>
      )}

      {view === "structured" ? (
        <StructuredView
          config={config}
          defaultIsOrphan={defaultIsOrphan}
          onSetDefault={setDefault}
          onAdd={addRegistry}
          onEdit={editRegistry}
          onRemove={(host) => setPendingDelete(host)}
        />
      ) : (
        <RawView
          text={rawText}
          onChange={(text) => {
            setRawText(text);
            if (rawParseError) setRawParseError(null);
            if (saveStatus) setSaveStatus(null);
          }}
          parseError={rawParseError}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty && !saveStatus && (
          <span className="text-xs text-fg-muted">Unsaved changes</span>
        )}
        {saveStatus && (
          <span className="text-xs text-accent">{saveStatus}</span>
        )}
      </div>

      {filePath && (
        <div className="font-mono text-[11px] text-fg-muted break-all">
          {filePath}
        </div>
      )}

      {view === "structured" && (
        <p className="text-[11px] text-fg-muted">
          Switching to Raw TOML and back may discard comments and custom
          whitespace.
        </p>
      )}

      {saveError && (
        <div className="rounded border border-stopped/40 bg-stopped/10 p-2 text-xs text-stopped">
          {saveError}
        </div>
      )}

      {editing && (
        <RegistryEditModal
          target={editing}
          existingHosts={config.registries.map((r) => r.host)}
          onCancel={() => setEditing(null)}
          onSubmit={upsertRegistry}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Remove registry '${pendingDelete}'?`}
          body={`This removes ${pendingDelete} from this config file. Other tools using the same file will lose the credentials.`}
          confirmLabel="Remove"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            removeRegistry(pendingDelete);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- Structured view ----------

interface StructuredViewProps {
  config: RegistriesConfig;
  defaultIsOrphan: boolean;
  onSetDefault: (host: string | null) => void;
  onAdd: () => void;
  onEdit: (host: string) => void;
  onRemove: (host: string) => void;
}

function StructuredView({
  config,
  defaultIsOrphan,
  onSetDefault,
  onAdd,
  onEdit,
  onRemove,
}: StructuredViewProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-fg-muted">
          Default registry
        </label>
        <select
          value={config.defaultRegistry ?? ""}
          onChange={(e) =>
            onSetDefault(e.target.value === "" ? null : e.target.value)
          }
          className="input py-1 text-xs"
        >
          <option value="">(none)</option>
          {defaultIsOrphan && config.defaultRegistry !== null && (
            <option value={config.defaultRegistry}>
              {config.defaultRegistry} (unknown: deleted)
            </option>
          )}
          {config.registries.map((r) => (
            <option key={r.host} value={r.host}>
              {r.host}
            </option>
          ))}
        </select>
        {defaultIsOrphan && (
          <span className="text-[11px] text-stopped">
            Default points at a registry no longer in this file.
          </span>
        )}
      </div>

      {config.registries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
          <div className="mb-3">No registries configured.</div>
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            Add registry
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {config.registries.map((entry) => (
              <RegistryCard
                key={entry.host}
                entry={entry}
                isDefault={config.defaultRegistry === entry.host}
                onEdit={() => onEdit(entry.host)}
                onRemove={() => onRemove(entry.host)}
              />
            ))}
          </div>
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-fg-muted hover:border-accent/60 hover:text-fg"
          >
            <Plus className="h-4 w-4" />
            Add registry
          </button>
        </>
      )}
    </div>
  );
}

interface RegistryCardProps {
  entry: RegistryEntry;
  isDefault: boolean;
  onEdit: () => void;
  onRemove: () => void;
}

function RegistryCard({ entry, isDefault, onEdit, onRemove }: RegistryCardProps) {
  const usesEnv = entry.passwordEnv !== null && entry.passwordEnv.length > 0;
  const usesPlaintext = entry.password !== null && entry.password.length > 0;

  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{entry.host}</span>
          {isDefault && (
            <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
              Default
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-card px-2 py-1 text-xs hover:bg-bg-card/70"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-md border border-stopped/40 bg-stopped/10 px-2 py-1 text-xs text-stopped hover:bg-stopped/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-fg-muted">Username</dt>
        <dd className="font-mono break-all">
          {entry.username ?? (
            <span className="text-fg-muted">(none)</span>
          )}
        </dd>
        <dt className="text-fg-muted">Secret</dt>
        <dd className="font-mono break-all">
          {usesEnv ? (
            <>
              <span className="text-fg-muted">env</span>{" "}
              <span>{entry.passwordEnv}</span>
            </>
          ) : usesPlaintext ? (
            <span className="text-starting">plaintext</span>
          ) : (
            <span className="text-fg-muted">(none)</span>
          )}
        </dd>
        <dt className="text-fg-muted">Mirror</dt>
        <dd className="font-mono break-all">
          {entry.mirror ?? <span className="text-fg-muted">(none)</span>}
        </dd>
      </dl>
      {usesEnv && usesPlaintext && (
        <div className="mt-2 flex items-start gap-1.5 rounded border border-starting/40 bg-starting/10 p-1.5 text-[11px] text-starting">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Both <span className="font-mono">password_env</span> and{" "}
          <span className="font-mono">password</span> are set. smolvm will use
          the env var; the plaintext value is unused but still on disk.
        </div>
      )}
    </div>
  );
}

// ---------- Raw view ----------

interface RawViewProps {
  text: string;
  onChange: (text: string) => void;
  parseError: string | null;
}

function RawView({ text, onChange, parseError }: RawViewProps) {
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        {...noAutoCorrect}
        className="input min-h-[14rem] w-full resize-y font-mono text-xs"
        placeholder={'# No registries configured yet.'}
      />
      {parseError && (
        <div className="rounded border border-stopped/40 bg-stopped/10 p-2 text-xs text-stopped">
          Couldn{"’"}t parse as TOML: {parseError}
        </div>
      )}
    </div>
  );
}

// ---------- Edit modal ----------

type EditorTarget = { kind: "add" } | { kind: "edit"; entry: RegistryEntry };
type AuthMode = "env" | "plaintext" | "none";

interface RegistryEditModalProps {
  target: EditorTarget;
  existingHosts: string[];
  onCancel: () => void;
  onSubmit: (entry: RegistryEntry, originalHost: string | null) => void;
}

function RegistryEditModal({
  target,
  existingHosts,
  onCancel,
  onSubmit,
}: RegistryEditModalProps) {
  const isEdit = target.kind === "edit";
  const original: RegistryEntry | null = isEdit ? target.entry : null;

  // Host + preset
  const initialHost = original?.host ?? "";
  const presetMatch = HOST_PRESETS.find((h) => h === initialHost);
  const [hostPreset, setHostPreset] = useState<string>(
    presetMatch ?? (initialHost.length > 0 ? "custom" : "docker.io"),
  );
  const [host, setHost] = useState<string>(
    initialHost || (presetMatch ?? "docker.io"),
  );

  const [username, setUsername] = useState<string>(original?.username ?? "");

  // Authentication mode
  const initialAuth: AuthMode =
    original === null
      ? "env"
      : original.passwordEnv !== null && original.passwordEnv.length > 0
        ? "env"
        : original.password !== null && original.password.length > 0
          ? "plaintext"
          : "env";
  const [authMode, setAuthMode] = useState<AuthMode>(initialAuth);
  const [envName, setEnvName] = useState<string>(
    original?.passwordEnv ?? suggestEnvVar(initialHost || "docker.io"),
  );
  const [envUserEdited, setEnvUserEdited] = useState<boolean>(
    original?.passwordEnv !== null && original?.passwordEnv !== undefined,
  );
  const [password, setPassword] = useState<string>(original?.password ?? "");

  const [mirror, setMirror] = useState<string>(original?.mirror ?? "");

  // Keep env var name in sync with hostname for new-or-untouched entries.
  useEffect(() => {
    if (envUserEdited) return;
    setEnvName(suggestEnvVar(host));
  }, [host, envUserEdited]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const trimmedHost = host.trim();
  const trimmedEnvName = envName.trim();
  const duplicateHost =
    !isEdit && existingHosts.some((h) => h === trimmedHost);
  const usernameMissing = username.length === 0;

  let validationError: string | null = null;
  if (trimmedHost.length === 0) {
    validationError = "Hostname is required.";
  } else if (duplicateHost) {
    validationError = `A registry for ${trimmedHost} already exists.`;
  } else if (usernameMissing) {
    validationError = "Username is required.";
  } else if (authMode === "env" && trimmedEnvName.length === 0) {
    validationError = "Env var name is required.";
  } else if (authMode === "plaintext" && password.length === 0) {
    validationError = "Password is required.";
  }

  const onPresetChange = (next: string) => {
    setHostPreset(next);
    if (next !== "custom") {
      setHost(next);
    }
  };

  const onSubmitClick = () => {
    if (validationError !== null) return;
    const next: RegistryEntry = {
      host: trimmedHost,
      username,
      passwordEnv: authMode === "env" ? trimmedEnvName : null,
      password: authMode === "plaintext" ? password : null,
      mirror: mirror.trim().length === 0 ? null : mirror,
    };
    onSubmit(next, isEdit ? (original?.host ?? null) : null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {isEdit ? `Edit ${original?.host ?? ""}` : "Add registry"}
          </h2>
          <button
            onClick={onCancel}
            className="rounded-md p-1 text-fg-muted hover:bg-bg hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-fg-muted">
              Hostname
            </label>
            {!isEdit && (
              <select
                value={hostPreset}
                onChange={(e) => onPresetChange(e.target.value)}
                className="input mb-1.5 w-full text-xs"
              >
                {HOST_PRESETS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
                <option value="custom">Custom{"…"}</option>
              </select>
            )}
            <input
              value={host}
              onChange={(e) => {
                setHost(e.target.value);
                if (!isEdit) setHostPreset("custom");
              }}
              disabled={isEdit}
              placeholder="registry.example.com"
              {...noAutoCorrect}
              className="input w-full font-mono disabled:opacity-60"
            />
            {isEdit && (
              <p className="mt-1 text-[11px] text-fg-muted">
                Hostname is the identity key and can{"’"}t be changed.
                Delete and re-add to rename.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-fg-muted">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your-username"
              {...noAutoCorrect}
              className="input w-full font-mono"
            />
          </div>

          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-fg-muted">
              Authentication
            </div>
            <div className="space-y-1.5">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  checked={authMode === "env"}
                  onChange={() => setAuthMode("env")}
                  className="mt-1 h-3.5 w-3.5 accent-accent"
                />
                <div className="flex-1">
                  <div>Use env var (recommended)</div>
                  {authMode === "env" && (
                    <div className="mt-1.5 space-y-1">
                      <input
                        value={envName}
                        onChange={(e) => {
                          setEnvName(e.target.value);
                          setEnvUserEdited(true);
                        }}
                        placeholder="DOCKER_HUB_TOKEN"
                        {...noAutoCorrect}
                        className="input w-full font-mono"
                      />
                      <p className="text-[11px] text-fg-muted">
                        smolvm reads the password from{" "}
                        <span className="font-mono">
                          ${trimmedEnvName || "ENV_NAME"}
                        </span>{" "}
                        at invocation time.
                      </p>
                    </div>
                  )}
                </div>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  checked={authMode === "plaintext"}
                  onChange={() => setAuthMode("plaintext")}
                  className="mt-1 h-3.5 w-3.5 accent-accent"
                />
                <div className="flex-1">
                  <div>Plaintext password (not recommended)</div>
                  {authMode === "plaintext" && (
                    <div className="mt-1.5 space-y-1">
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="password"
                        {...noAutoCorrect}
                        className="input w-full font-mono"
                      />
                      <p className="text-[11px] text-starting">
                        Stored unencrypted in registries.toml. Prefer env var.
                      </p>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-fg-muted">
              Mirror URL <span className="normal-case text-fg-muted">(optional)</span>
            </label>
            <input
              value={mirror}
              onChange={(e) => setMirror(e.target.value)}
              placeholder="mirror.example.com"
              {...noAutoCorrect}
              className="input w-full font-mono"
            />
          </div>

          {validationError && (
            <div className="rounded border border-stopped/40 bg-stopped/10 p-2 text-xs text-stopped">
              {validationError}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg"
          >
            Cancel
          </button>
          <button
            onClick={onSubmitClick}
            disabled={validationError !== null}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {isEdit ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Confirm dialog ----------

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-bg-card p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-stopped" />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <p className="text-sm text-fg-muted">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-stopped px-3 py-1.5 text-sm font-medium text-white hover:bg-stopped/90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
