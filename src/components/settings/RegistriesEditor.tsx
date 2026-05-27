import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/invoke";
import {
  EMPTY_CONFIG,
  NamespaceKey,
  RegistryEntry,
  RegistryNamespace,
  SmolConfig,
  cloneConfig,
  equals as configsEqual,
  parse as parseConfig,
  stringify as stringifyConfig,
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

/**
 * Native selects render shorter than `.input` text fields in WKWebView because
 * they ignore part of the CSS box model. `appearance-none` makes them respect
 * it exactly (matching input height); we draw our own chevron back in.
 */
function StyledSelect({
  value,
  onChange,
  children,
  wrapperClassName = "",
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  wrapperClassName?: string;
}) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select
        value={value}
        onChange={onChange}
        className="input w-full appearance-none pr-8"
      >
        {children}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
    </div>
  );
}

const NAMESPACE_META: Record<
  NamespaceKey,
  { title: string; blurb: string; noneLabel: string; addLabel: string }
> = {
  images: {
    title: "Image registries",
    blurb: "Container image registries for base images ([images]).",
    noneLabel: "No image registries configured.",
    addLabel: "Add image registry",
  },
  machines: {
    title: "Machine registries",
    blurb: ".smolmachine artifact registries ([machines]).",
    noneLabel: "No machine registries configured.",
    addLabel: "Add machine registry",
  },
};

interface RegistriesEditorProps {
  /** Raw TOML text loaded from disk; "" if file doesn't exist. */
  initialText: string;
  /** Absolute path to the config.toml file on disk, if known. */
  filePath: string | null;
  /** Initial load error (e.g. backend couldn't read the file). */
  loadError: string | null;
  /** Called after a successful auto-save so the parent can refresh derived views. */
  onSaved?: () => void;
}

interface DiskState {
  text: string;
  parsed: SmolConfig;
  /** Whether the on-disk text round-trips cleanly through structured mode. */
  parsedClean: boolean;
}

function safeParse(text: string): {
  config: SmolConfig;
  error: string | null;
} {
  try {
    return { config: parseConfig(text), error: null };
  } catch (e) {
    return { config: cloneConfig(EMPTY_CONFIG), error: String(e) };
  }
}

export function RegistriesEditor({
  initialText,
  filePath,
  loadError,
  onSaved,
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
  const [config, setConfig] = useState<SmolConfig>(() =>
    cloneConfig(initialParse.config),
  );
  const [rawText, setRawText] = useState<string>(initialText);
  const [rawParseError, setRawParseError] = useState<string | null>(null);

  /** Add/edit modal target, scoped to a namespace. */
  const [editing, setEditing] = useState<{
    namespace: NamespaceKey;
    target: EditorTarget;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    namespace: NamespaceKey;
    host: string;
  } | null>(null);

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
    setRawText(stringifyConfig(config));
    setRawParseError(null);
    setView("raw");
  };

  /** Switch from Raw → Structured: try to parse rawText. Stay in Raw on error. */
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
    let newConfig: SmolConfig;
    let newText: string;

    if (view === "structured") {
      payload = stringifyConfig(config);
      newConfig = cloneConfig(config);
      newText = payload;
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
    }

    setSaving(true);
    try {
      await api.writeRegistries(payload);
      setDisk({ text: newText, parsed: newConfig, parsedClean: true });
      if (view === "raw") {
        setConfig(cloneConfig(newConfig));
      } else {
        setRawText(newText);
      }
      setSaveStatus("Saved.");
      onSaved?.();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Auto-save: persist whenever there are unsaved changes, debounced so
  // typing doesn't thrash the disk. Covers every structured mutation and
  // (when it parses cleanly) the raw editor. No explicit Save button.
  useEffect(() => {
    if (!dirty || saving) return;
    const t = setTimeout(() => {
      void onSave();
    }, 600);
    return () => clearTimeout(t);
    // onSave closes over current state; deps below capture every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, rawText, view, dirty, saving]);

  // ----- Cloud mutators -----

  const setCloud = (patch: Partial<SmolConfig["cloud"]>) => {
    setConfig((prev) => {
      const next = cloneConfig(prev);
      next.cloud = { ...next.cloud, ...patch };
      return next;
    });
    setSaveStatus(null);
  };

  // ----- Namespace mutators -----

  const mutateNamespace = (
    namespace: NamespaceKey,
    fn: (ns: RegistryNamespace) => void,
  ) => {
    setConfig((prev) => {
      const next = cloneConfig(prev);
      fn(next[namespace]);
      return next;
    });
    setSaveStatus(null);
  };

  const removeRegistry = (namespace: NamespaceKey, host: string) => {
    mutateNamespace(namespace, (ns) => {
      ns.registries = ns.registries.filter((r) => r.host !== host);
      if (ns.defaultRegistry === host) ns.defaultRegistry = null;
    });
  };

  const upsertRegistry = (
    namespace: NamespaceKey,
    entry: RegistryEntry,
    originalHost: string | null,
  ) => {
    mutateNamespace(namespace, (ns) => {
      if (originalHost === null) {
        if (ns.registries.some((r) => r.host === entry.host)) return;
        ns.registries.push(entry);
      } else {
        const idx = ns.registries.findIndex((r) => r.host === originalHost);
        if (idx < 0) return;
        ns.registries[idx] = entry;
      }
    });
    setEditing(null);
  };

  const setDefault = (namespace: NamespaceKey, host: string | null) => {
    mutateNamespace(namespace, (ns) => {
      ns.defaultRegistry = host;
    });
  };

  return (
    <div className="space-y-4 rounded-md border border-border bg-bg-card p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-fg-muted">
          smolvm{"'"}s unified config{" "}
          <span className="font-mono">config.toml</span> — smolcloud API
          settings plus image and machine registry credentials. Login-managed
          tokens in this file are preserved untouched. Saved files are validated
          by smolvm on its next invocation.
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
          The file on disk couldn{"'"}t be parsed cleanly; you{"'"}re editing a
          fresh structure. Saving will overwrite the file.
        </div>
      )}

      {view === "structured" ? (
        <div className="space-y-5">
          <CloudSection cloud={config.cloud} onChange={setCloud} />
          <RegistryGroup
            namespace="images"
            ns={config.images}
            onSetDefault={(host) => setDefault("images", host)}
            onAdd={() => setEditing({ namespace: "images", target: { kind: "add" } })}
            onEdit={(entry) =>
              setEditing({ namespace: "images", target: { kind: "edit", entry } })
            }
            onRemove={(host) => setPendingDelete({ namespace: "images", host })}
          />
          <RegistryGroup
            namespace="machines"
            ns={config.machines}
            onSetDefault={(host) => setDefault("machines", host)}
            onAdd={() =>
              setEditing({ namespace: "machines", target: { kind: "add" } })
            }
            onEdit={(entry) =>
              setEditing({
                namespace: "machines",
                target: { kind: "edit", entry },
              })
            }
            onRemove={(host) =>
              setPendingDelete({ namespace: "machines", host })
            }
          />
        </div>
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

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {saving || dirty ? (
          <span className="inline-flex items-center gap-1.5 text-fg-muted">
            <Save className="h-3.5 w-3.5 animate-pulse" />
            Saving…
          </span>
        ) : saveStatus ? (
          <span className="text-accent">{saveStatus}</span>
        ) : null}
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
          namespace={editing.namespace}
          target={editing.target}
          existingHosts={config[editing.namespace].registries.map((r) => r.host)}
          onCancel={() => setEditing(null)}
          onSubmit={(entry, originalHost) =>
            upsertRegistry(editing.namespace, entry, originalHost)
          }
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Remove registry '${pendingDelete.host}'?`}
          body={`This removes ${pendingDelete.host} from the ${pendingDelete.namespace} section of config.toml.`}
          confirmLabel="Remove"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            removeRegistry(pendingDelete.namespace, pendingDelete.host);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- Cloud section ----------

interface CloudSectionProps {
  cloud: SmolConfig["cloud"];
  onChange: (patch: Partial<SmolConfig["cloud"]>) => void;
}

function CloudSection({ cloud, onChange }: CloudSectionProps) {
  const [showKey, setShowKey] = useState(false);

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg">
          Cloud
        </h3>
        <p className="text-[11px] text-fg-muted">
          smolcloud API settings ([cloud]). Login tokens are managed by{" "}
          <span className="font-mono">smolvm login</span> and preserved here
          untouched.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-fg-muted">
            Endpoint
          </label>
          <input
            value={cloud.endpoint ?? ""}
            onChange={(e) =>
              onChange({ endpoint: e.target.value === "" ? null : e.target.value })
            }
            placeholder="https://api.smolmachines.com"
            {...noAutoCorrect}
            className="input w-full font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-fg-muted">
            API key
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={cloud.apiKey ?? ""}
              onChange={(e) =>
                onChange({ apiKey: e.target.value === "" ? null : e.target.value })
              }
              placeholder="smk_…"
              {...noAutoCorrect}
              className="input w-full pr-9 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-2 text-fg-muted hover:text-fg"
              title={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Registry group (shared by images + machines) ----------

interface RegistryGroupProps {
  namespace: NamespaceKey;
  ns: RegistryNamespace;
  onSetDefault: (host: string | null) => void;
  onAdd: () => void;
  onEdit: (entry: RegistryEntry) => void;
  onRemove: (host: string) => void;
}

function RegistryGroup({
  namespace,
  ns,
  onSetDefault,
  onAdd,
  onEdit,
  onRemove,
}: RegistryGroupProps) {
  const meta = NAMESPACE_META[namespace];
  const knownHosts = new Set(ns.registries.map((r) => r.host));
  const defaultIsOrphan =
    ns.defaultRegistry !== null && !knownHosts.has(ns.defaultRegistry);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg">
          {meta.title}
        </h3>
        <p className="text-[11px] text-fg-muted">{meta.blurb}</p>
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-fg-muted">
          Default registry
        </label>
        <StyledSelect
          value={ns.defaultRegistry ?? ""}
          onChange={(e) =>
            onSetDefault(e.target.value === "" ? null : e.target.value)
          }
        >
          <option value="">(none)</option>
          {defaultIsOrphan && ns.defaultRegistry !== null && (
            <option value={ns.defaultRegistry}>
              {ns.defaultRegistry} (unknown: deleted)
            </option>
          )}
          {ns.registries.map((r) => (
            <option key={r.host} value={r.host}>
              {r.host}
            </option>
          ))}
        </StyledSelect>
        {defaultIsOrphan && (
          <span className="mt-1 block text-[11px] text-stopped">
            Default points at a registry no longer in this section.
          </span>
        )}
      </div>

      {ns.registries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
          <div className="mb-3">{meta.noneLabel}</div>
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            {meta.addLabel}
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {ns.registries.map((entry) => (
              <RegistryCard
                key={entry.host}
                entry={entry}
                isDefault={ns.defaultRegistry === entry.host}
                onEdit={() => onEdit(entry)}
                onRemove={() => onRemove(entry.host)}
              />
            ))}
          </div>
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-fg-muted hover:border-accent/60 hover:text-fg"
          >
            <Plus className="h-4 w-4" />
            {meta.addLabel}
          </button>
        </>
      )}
    </section>
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
          {entry.username ?? <span className="text-fg-muted">(none)</span>}
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
        className="input min-h-[18rem] w-full resize-y font-mono text-xs"
        placeholder={"# Empty config.toml"}
      />
      {parseError && (
        <div className="rounded border border-stopped/40 bg-stopped/10 p-2 text-xs text-stopped">
          Couldn{"'"}t parse as TOML: {parseError}
        </div>
      )}
    </div>
  );
}

// ---------- Edit modal ----------

type EditorTarget = { kind: "add" } | { kind: "edit"; entry: RegistryEntry };
type AuthMode = "env" | "plaintext";

interface RegistryEditModalProps {
  namespace: NamespaceKey;
  target: EditorTarget;
  existingHosts: string[];
  onCancel: () => void;
  onSubmit: (entry: RegistryEntry, originalHost: string | null) => void;
}

function RegistryEditModal({
  namespace,
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

  // Authentication mode — env var wins when both are present.
  const initialAuth: AuthMode =
    original !== null &&
    !(original.passwordEnv && original.passwordEnv.length > 0) &&
    original.password !== null &&
    original.password.length > 0
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
  const duplicateHost = !isEdit && existingHosts.some((h) => h === trimmedHost);
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
    if (next !== "custom") setHost(next);
  };

  const onSubmitClick = () => {
    if (validationError !== null) return;
    // Preserve the unselected auth field when editing so we don't silently
    // strip an existing plaintext/env value the user chose not to touch.
    const next: RegistryEntry = {
      host: trimmedHost,
      username,
      passwordEnv:
        authMode === "env"
          ? trimmedEnvName
          : (original?.passwordEnv ?? null),
      password:
        authMode === "plaintext" ? password : (original?.password ?? null),
      mirror: mirror.trim().length === 0 ? null : mirror,
    };
    onSubmit(next, isEdit ? (original?.host ?? null) : null);
  };

  const nsLabel = namespace === "images" ? "image" : "machine";

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
            {isEdit
              ? `Edit ${original?.host ?? ""}`
              : `Add ${nsLabel} registry`}
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
              <StyledSelect
                value={hostPreset}
                onChange={(e) => onPresetChange(e.target.value)}
                wrapperClassName="mb-1.5"
              >
                {HOST_PRESETS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </StyledSelect>
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
                Hostname is the identity key and can{"'"}t be changed. Delete
                and re-add to rename.
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
                        {`smolvm reads the password from $${
                          trimmedEnvName || "ENV_NAME"
                        } at invocation time.`}
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
                        Stored unencrypted in config.toml. Prefer env var.
                      </p>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-fg-muted">
              Mirror URL{" "}
              <span className="normal-case text-fg-muted">(optional)</span>
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
