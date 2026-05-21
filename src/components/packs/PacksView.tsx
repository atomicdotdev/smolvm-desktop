import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ChevronDown,
  Download,
  FolderOpen,
  Globe,
  Hammer,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { api } from "@/lib/invoke";
import type { Pack } from "@/lib/types";
import { defaultPackDir, defaultSmolfileDir } from "@/lib/paths";
import { useMachinesStore } from "@/hooks/useMachines";

type Tab = "local" | "build" | "transport";

const noAutoCorrect = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  autoComplete: "off",
} as const;

export function PacksView({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const [tab, setTab] = useState<Tab>("local");

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border bg-bg px-6 py-4">
        <h1 className="text-xl font-semibold">Packs</h1>
        <p className="text-sm text-fg-muted">
          Build, inspect, and share <code>.smolmachine</code> artifacts.
        </p>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-border bg-bg px-4 pt-2 text-sm">
        <TabButton active={tab === "local"} onClick={() => setTab("local")}>
          Local
        </TabButton>
        <TabButton active={tab === "build"} onClick={() => setTab("build")}>
          Build
        </TabButton>
        <TabButton
          active={tab === "transport"}
          onClick={() => setTab("transport")}
        >
          Push / Pull
        </TabButton>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "local" && <LocalTab />}
        {tab === "build" && <BuildTab />}
        {tab === "transport" && <TransportTab onOpenSettings={onOpenSettings} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px rounded-t-md border border-b-0 px-3 py-1.5 ${
        active
          ? "border-border bg-bg-card text-fg"
          : "border-transparent text-fg-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function LocalTab() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Pack | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listPacks();
      setPacks(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pickAndAdd = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "SmolVM pack", extensions: ["smolmachine"] }],
      defaultPath: await defaultPackDir(),
    });
    if (typeof path !== "string") return;
    try {
      const pack = await api.inspectPack(path);
      setPicked(pack);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const runPack = async (path: string) => {
    try {
      await api.runPack(path, { network: true });
    } catch (e) {
      setError(String(e));
    }
  };

  const prune = async () => {
    try {
      const out = await api.prunePacks(true, false);
      alert(out || "Dry-run complete.");
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-bg/50 px-6 py-3">
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70 disabled:opacity-70"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <button
          onClick={pickAndAdd}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70"
        >
          <FolderOpen className="h-4 w-4" />
          Open pack…
        </button>
        <button
          onClick={prune}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70"
          title="smolvm pack prune --dry-run"
        >
          <Trash2 className="h-4 w-4" />
          Prune (dry-run)
        </button>
      </div>

      {error && (
        <div className="border-b border-stopped/40 bg-stopped/10 px-6 py-3 text-sm text-stopped">
          {error}
        </div>
      )}

      <div className="border-b border-border bg-bg/50 px-6 py-2 text-xs text-fg-muted">
        smolvm does not maintain a pack registry — packs live wherever you saved
        them. This scans <code>~/.smolvm/packs</code> and{" "}
        <code>~/Documents/smolvm-packs</code>; use <em>Open pack</em> for files
        elsewhere.
      </div>

      {packs.length === 0 && !picked ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center text-fg-muted">
          <Package className="h-10 w-10 text-fg-muted/60" />
          <p className="text-base">No packs found.</p>
          <p className="max-w-md text-sm">
            Build one in the <strong>Build</strong> tab, or use{" "}
            <em>Open pack</em> to load a <code>.smolmachine</code> from
            anywhere.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr className="border-b border-border">
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Image</th>
              <th className="px-6 py-3 font-medium">Size</th>
              <th className="px-6 py-3 font-medium">Path</th>
              <th className="px-6 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...(picked ? [picked] : []), ...packs].map((p) => (
              <tr
                key={p.path}
                className="border-b border-border/60 hover:bg-bg-card/40"
              >
                <td className="px-6 py-3">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <Archive className="h-4 w-4 text-accent" />
                    {p.name}
                  </span>
                </td>
                <td className="px-6 py-3 text-fg-muted">{p.image ?? "—"}</td>
                <td className="px-6 py-3 font-mono text-xs text-fg-muted">
                  {formatSize(p.size_bytes)}
                </td>
                <td className="px-6 py-3 font-mono text-xs text-fg-muted break-all">
                  {p.path}
                </td>
                <td className="px-6 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => runPack(p.path)}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent/90"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Run
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BuildTab() {
  const [source, setSource] = useState<"smolfile" | "from_vm" | "image">(
    "smolfile",
  );
  const [smolfile, setSmolfile] = useState("");
  const [fromVm, setFromVm] = useState("");
  const [image, setImage] = useState("");
  const [output, setOutput] = useState("");
  const [outputUserEdited, setOutputUserEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smolfileUrl, setSmolfileUrl] = useState("");
  const [fetching, setFetching] = useState(false);

  // Auto-suggest an output path from the active source, until the user
  // edits the field themselves (then we get out of the way).
  useEffect(() => {
    if (outputUserEdited) return;
    let stem = "";
    if (source === "smolfile" && smolfile) {
      const base = smolfile.split("/").pop() ?? "";
      stem = base.replace(/\.(smolfile|toml)$/i, "") || base;
    } else if (source === "from_vm" && fromVm) {
      stem = fromVm;
    } else if (source === "image" && image) {
      // alpine:latest → alpine, ghcr.io/foo/bar:v1 → bar
      const lastSegment = image.split("/").pop() ?? image;
      stem = lastSegment.split(":")[0] ?? lastSegment;
    }
    if (!stem) {
      setOutput("");
      return;
    }
    defaultPackDir()
      .then((dir) => join(dir, `${stem}.smolmachine`))
      .then(setOutput)
      .catch(() => {
        /* leave blank */
      });
  }, [source, smolfile, fromVm, image, outputUserEdited]);

  const canBuild = (() => {
    if (!output.trim()) return false;
    if (source === "smolfile") return smolfile.trim().length > 0;
    if (source === "from_vm") return fromVm.trim().length > 0;
    if (source === "image") return image.trim().length > 0;
    return false;
  })();

  const fetchSmolfileUrl = async () => {
    setFetching(true);
    setError(null);
    try {
      const path = await api.fetchSmolfileFromUrl(smolfileUrl.trim());
      setSmolfile(path);
      setSmolfileUrl("");
    } catch (e) {
      setError(String(e));
    } finally {
      setFetching(false);
    }
  };

  const pickSmolfile = async () => {
    // Smolfiles are TOML. The conventional name is `Smolfile` (no extension)
    // at the project root, but any *.toml is also valid. macOS still lets the
    // user toggle to "All files" via the filter dropdown for the no-ext case.
    const picked = await openDialog({
      multiple: false,
      filters: [
        { name: "Smolfile (TOML)", extensions: ["toml", "Smolfile"] },
        { name: "All files", extensions: ["*"] },
      ],
      defaultPath: await defaultSmolfileDir(),
    });
    if (typeof picked === "string") setSmolfile(picked);
  };

  const pickOutput = async () => {
    const picked = await saveDialog({
      filters: [{ name: "SmolVM pack", extensions: ["smolmachine"] }],
      defaultPath:
        output.trim() ||
        (await join(await defaultPackDir(), "machine.smolmachine")),
    });
    if (typeof picked === "string") {
      setOutput(picked);
      setOutputUserEdited(true);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const out = await api.createPack({
        smolfile: source === "smolfile" ? smolfile.trim() || null : null,
        from_vm: source === "from_vm" ? fromVm.trim() || null : null,
        image: source === "image" ? image.trim() || null : null,
        output: output.trim() || null,
      });
      setResult(out || "Pack created.");
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const sourceLabel = (() => {
    if (source === "smolfile") return smolfile.split("/").pop() || "smolfile";
    if (source === "from_vm") return fromVm || "VM";
    return image || "image";
  })();

  return (
    <div className="space-y-4 p-6">
      {submitting && <BuildBlockingModal sourceLabel={sourceLabel} />}
      <div className="rounded-md border border-border bg-bg/50 px-4 py-3 text-xs text-fg-muted">
        Runs <code>smolvm pack create</code>. The VM must be stopped when
        packing from an existing machine.
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Source</div>
        <div className="grid grid-cols-3 gap-2">
          <RadioCard
            active={source === "smolfile"}
            onClick={() => setSource("smolfile")}
            title="From smolfile"
            subtitle="Build from a recipe."
          />
          <RadioCard
            active={source === "image"}
            onClick={() => setSource("image")}
            title="From image"
            subtitle="Pack an OCI image."
          />
          <RadioCard
            active={source === "from_vm"}
            onClick={() => setSource("from_vm")}
            title="From VM"
            subtitle="Snapshot a stopped VM."
          />
        </div>
      </div>

      {source === "smolfile" && (
        <div className="space-y-2">
          <Field label="Smolfile path">
            <div className="flex gap-1">
              <input
                {...noAutoCorrect}
                value={smolfile}
                onChange={(e) => setSmolfile(e.target.value)}
                placeholder="/path/to/smolfile"
                className="input flex-1 font-mono"
              />
              <button
                type="button"
                onClick={pickSmolfile}
                className="rounded-md border border-border bg-bg-card px-2 text-fg-muted hover:text-fg"
                title="Browse"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          </Field>
          <Field
            label="Or fetch from URL"
            hint="GitHub blob URLs are auto-converted to raw"
          >
            <div className="flex gap-1">
              <div className="relative flex-1">
                <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
                <input
                  {...noAutoCorrect}
                  value={smolfileUrl}
                  onChange={(e) => setSmolfileUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && smolfileUrl.trim() && !fetching) {
                      e.preventDefault();
                      fetchSmolfileUrl();
                    }
                  }}
                  placeholder="https://github.com/owner/repo/blob/main/example.smolfile"
                  className="input w-full pl-8 font-mono"
                />
              </div>
              <button
                type="button"
                onClick={fetchSmolfileUrl}
                disabled={!smolfileUrl.trim() || fetching}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 text-sm hover:bg-bg-card/70 disabled:opacity-50"
              >
                {fetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Fetch
              </button>
            </div>
          </Field>
        </div>
      )}

      {source === "image" && (
        <Field label="OCI image" hint="e.g. alpine:latest or python:3.11-slim">
          <input
            {...noAutoCorrect}
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="alpine:latest"
            className="input font-mono"
          />
        </Field>
      )}

      {source === "from_vm" && (
        <Field label="VM" hint="must be stopped">
          <VmPicker value={fromVm} onChange={setFromVm} />
        </Field>
      )}

      <Field label="Output path" hint="where to write the .smolmachine">
        <div className="flex gap-1">
          <input
            {...noAutoCorrect}
            value={output}
            onChange={(e) => {
              setOutput(e.target.value);
              setOutputUserEdited(true);
            }}
            placeholder="/path/to/out.smolmachine"
            className="input flex-1 font-mono"
          />
          <button
            type="button"
            onClick={pickOutput}
            className="rounded-md border border-border bg-bg-card px-2 text-fg-muted hover:text-fg"
            title="Browse"
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        </div>
      </Field>

      {error && (
        <div className="rounded-md border border-stopped/40 bg-stopped/10 p-3 text-sm text-stopped">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded-md border border-running/40 bg-running/10 p-3 text-sm">
          <pre className="whitespace-pre-wrap font-mono text-xs">{result}</pre>
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting || !canBuild}
        title={
          canBuild
            ? undefined
            : "Set the source and output path to enable Build."
        }
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
      >
        <Hammer className="h-4 w-4" />
        {submitting ? "Building…" : "Build pack"}
      </button>
    </div>
  );
}

function TransportTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [pushPath, setPushPath] = useState("");
  const [pushRef, setPushRef] = useState("");
  const [pullRef, setPullRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const pickPush = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "SmolVM pack", extensions: ["smolmachine"] }],
      defaultPath: await defaultPackDir(),
    });
    if (typeof picked === "string") setPushPath(picked);
  };

  const doPush = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await api.pushPack(pushPath.trim(), pushRef.trim());
      setResult(out || "Pushed.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doPull = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await api.pullPack(pullRef.trim());
      setResult(out || "Pulled.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-md border border-border bg-bg/50 px-4 py-3 text-xs text-fg-muted">
        Registry credentials live in smolvm&apos;s config under{" "}
        <code>registries</code>.{" "}
        <button
          onClick={onOpenSettings}
          className="underline hover:text-fg"
        >
          Configure registries →
        </button>
      </div>

      <section className="space-y-3 rounded-md border border-border bg-bg-card p-4">
        <h2 className="text-sm font-semibold">Push</h2>
        <Field label="Pack path">
          <div className="flex gap-1">
            <input
              {...noAutoCorrect}
              value={pushPath}
              onChange={(e) => setPushPath(e.target.value)}
              placeholder="/path/to/pack.smolmachine"
              className="input flex-1 font-mono"
            />
            <button
              type="button"
              onClick={pickPush}
              className="rounded-md border border-border bg-bg-card px-2 text-fg-muted hover:text-fg"
              title="Browse"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
        </Field>
        <Field label="Registry ref">
          <input
            {...noAutoCorrect}
            value={pushRef}
            onChange={(e) => setPushRef(e.target.value)}
            placeholder="ghcr.io/org/pack:tag"
            className="input font-mono"
          />
        </Field>
        <button
          onClick={doPush}
          disabled={busy || !pushPath || !pushRef}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          Push
        </button>
      </section>

      <section className="space-y-3 rounded-md border border-border bg-bg-card p-4">
        <h2 className="text-sm font-semibold">Pull</h2>
        <Field label="Registry ref">
          <input
            {...noAutoCorrect}
            value={pullRef}
            onChange={(e) => setPullRef(e.target.value)}
            placeholder="ghcr.io/org/pack:tag"
            className="input font-mono"
          />
        </Field>
        <button
          onClick={doPull}
          disabled={busy || !pullRef}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Pull
        </button>
      </section>

      {error && (
        <div className="rounded-md border border-stopped/40 bg-stopped/10 p-3 text-sm text-stopped">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded-md border border-running/40 bg-running/10 p-3 text-sm">
          <pre className="whitespace-pre-wrap font-mono text-xs">{result}</pre>
        </div>
      )}
    </div>
  );
}

function RadioCard({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-left transition-colors ${
        active
          ? "border-accent/60 bg-accent/15 text-fg"
          : "border-border text-fg-muted hover:text-fg"
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-fg-muted">{subtitle}</div>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-fg-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function BuildBlockingModal({ sourceLabel }: { sourceLabel: string }) {
  // Swallow Escape so the modal can't be dismissed during a build. Pack
  // create can take minutes (image pull + layer assembly + signing) and
  // killing mid-flight leaves the output half-written.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-border bg-bg-card p-6 shadow-2xl">
        <Hammer className="h-8 w-8 animate-pulse text-accent" />
        <h2 className="text-base font-semibold">Building pack…</h2>
        <p className="text-center text-sm text-fg-muted">
          Packing <span className="font-mono text-fg">{sourceLabel}</span>.
        </p>
        <p className="text-center text-xs text-fg-muted">
          This can take several minutes — large images pull, extract, and
          re-assemble before the final binary is signed. Don&apos;t navigate
          away.
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Working…
        </div>
      </div>
    </div>
  );
}

function VmPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const machines = useMachinesStore((s) => s.machines);
  const stopped = machines.filter(
    (m) => m.status === "stopped" || m.status === "created" || m.status === "exited",
  );

  if (stopped.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg-card/40 px-3 py-2 text-sm text-fg-muted">
        No stopped VMs available. Stop a machine on the Machines tab to pack
        it.
      </div>
    );
  }

  // Show value even if it's not in the current list (e.g. the VM was started
  // or removed since picking) so we don't silently swallow the selection.
  const valueInList = stopped.some((m) => m.name === value);
  const missing = value && !valueInList;

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full cursor-pointer appearance-none pr-9"
      >
        <option value="">Select a stopped VM…</option>
        {missing && (
          <option value={value}>{value} (not stopped — refresh)</option>
        )}
        {stopped.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name}
            {m.image ? ` · ${m.image}` : ""}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
    </div>
  );
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}
