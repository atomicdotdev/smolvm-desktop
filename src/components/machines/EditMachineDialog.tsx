import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Plus, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "@/lib/invoke";
import { useMachinesStore } from "@/hooks/useMachines";
import type {
  EnvVar,
  Machine,
  MachinePatch,
  PortMapping,
  VolumeMount,
} from "@/lib/types";

const noAutoCorrect = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  autoComplete: "off",
} as const;

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
function isValidEnvKey(key: string): boolean {
  return ENV_KEY_RE.test(key);
}

interface Props {
  open: boolean;
  machine: Machine;
  onClose: () => void;
  onUpdated?: () => void;
}

/** Pull env vars from inspect's raw JSON if present. Defensive: smolvm's
 *  JSON shape isn't strictly stable, so we accept a few plausible forms:
 *    - {"env": {"KEY":"val"}}
 *    - {"env": ["KEY=val", ...]}
 *    - {"env": [{"key":"KEY","value":"val"}, ...]} */
function envFromInspect(raw: unknown): EnvVar[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const v = obj.env ?? obj.environment ?? obj.envs;
  if (!v) return [];
  if (Array.isArray(v)) {
    const out: EnvVar[] = [];
    for (const item of v) {
      if (typeof item === "string") {
        const idx = item.indexOf("=");
        if (idx > 0) {
          out.push({ key: item.slice(0, idx), value: item.slice(idx + 1) });
        }
      } else if (item && typeof item === "object") {
        const it = item as Record<string, unknown>;
        const key = typeof it.key === "string" ? it.key : typeof it.name === "string" ? it.name : null;
        const val = typeof it.value === "string" ? it.value : "";
        if (key) out.push({ key, value: val });
      }
    }
    return out;
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).map(([k, val]) => ({
      key: k,
      value: typeof val === "string" ? val : String(val ?? ""),
    }));
  }
  return [];
}

function workdirFromInspect(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const obj = raw as Record<string, unknown>;
  const v = obj.workdir ?? obj.working_dir ?? obj.workingDir;
  return typeof v === "string" ? v : "";
}

function gpuFromInspect(raw: unknown): { gpu: boolean; vram: number | null } {
  if (!raw || typeof raw !== "object") return { gpu: false, vram: null };
  const obj = raw as Record<string, unknown>;
  const gpuRaw = obj.gpu;
  let gpu = false;
  let vram: number | null = null;
  if (typeof gpuRaw === "boolean") gpu = gpuRaw;
  else if (gpuRaw && typeof gpuRaw === "object") {
    const g = gpuRaw as Record<string, unknown>;
    if (typeof g.enabled === "boolean") gpu = g.enabled;
    const vramVal = g.vram_mib ?? g.vramMib ?? g.vram;
    if (typeof vramVal === "number") vram = vramVal;
  }
  const topVram = obj.gpu_vram_mib ?? obj.gpuVramMib;
  if (vram === null && typeof topVram === "number") vram = topVram;
  return { gpu, vram };
}

function numFromInspect(raw: unknown, ...keys: string[]): number | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
  }
  return null;
}

function volumeSpec(v: VolumeMount): string {
  const base = `${v.host_path}:${v.guest_path}`;
  return v.readonly ? `${base}:ro` : base;
}

function portSpec(p: PortMapping): string {
  return `${p.host}:${p.guest}`;
}

export function EditMachineDialog({ open, machine, onClose, onUpdated }: Props) {
  // Snapshot of original values used to compute the diff on submit.
  const original = useMemo(
    () => ({
      cpus: machine.cpus,
      memory_mb: machine.memory_mb,
      network: machine.network,
      ports: machine.ports,
      mounts: machine.mounts,
    }),
    [machine],
  );

  const [cpus, setCpus] = useState("");
  const [mem, setMem] = useState("");
  const [network, setNetwork] = useState(machine.network);
  const [workdir, setWorkdir] = useState("");
  const [origWorkdir, setOrigWorkdir] = useState("");
  const [gpu, setGpu] = useState(false);
  const [origGpu, setOrigGpu] = useState(false);
  const [gpuVram, setGpuVram] = useState("");
  const [origGpuVram, setOrigGpuVram] = useState<number | null>(null);
  const [storage, setStorage] = useState("");
  const [origStorage, setOrigStorage] = useState<number | null>(null);
  const [overlay, setOverlay] = useState("");
  const [origOverlay, setOrigOverlay] = useState<number | null>(null);

  const [volumes, setVolumes] = useState<VolumeMount[]>([]);
  const [ports, setPorts] = useState<PortMapping[]>([]);
  // Existing env loaded from inspect (best-effort) so we can diff add/remove.
  const [origEnv, setOrigEnv] = useState<EnvVar[]>([]);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingInspect, setLoadingInspect] = useState(true);

  const refresh = useMachinesStore((s) => s.refresh);

  // Pre-populate from machine + inspect raw on open.
  useEffect(() => {
    if (!open) return;
    let alive = true;

    setCpus(machine.cpus !== null ? String(machine.cpus) : "");
    setMem(machine.memory_mb !== null ? String(machine.memory_mb) : "");
    setNetwork(machine.network);
    setVolumes(machine.mounts.map((m) => ({ ...m })));
    setPorts(machine.ports.map((p) => ({ ...p })));
    setError(null);
    setSubmitting(false);
    setLoadingInspect(true);

    api
      .inspectMachine(machine.name)
      .then((r) => {
        if (!alive) return;
        const raw = r.raw;
        const env = envFromInspect(raw);
        setOrigEnv(env);
        setEnvVars(env.map((e) => ({ ...e })));
        const wd = workdirFromInspect(raw);
        setWorkdir(wd);
        setOrigWorkdir(wd);
        const g = gpuFromInspect(raw);
        setGpu(g.gpu);
        setOrigGpu(g.gpu);
        setGpuVram(g.vram !== null ? String(g.vram) : "");
        setOrigGpuVram(g.vram);
        const st = numFromInspect(raw, "storage_gib", "storageGib", "storage");
        setStorage(st !== null ? String(st) : "");
        setOrigStorage(st);
        const ov = numFromInspect(raw, "overlay_gib", "overlayGib", "overlay");
        setOverlay(ov !== null ? String(ov) : "");
        setOrigOverlay(ov);
      })
      .catch(() => {
        // Inspect is best-effort. Leave env/workdir/gpu blank — the diff
        // will simply not emit those flags.
      })
      .finally(() => {
        if (alive) setLoadingInspect(false);
      });

    return () => {
      alive = false;
    };
  }, [open, machine]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const buildPatch = (): MachinePatch | null => {
    const patch: MachinePatch = {};

    const parsedCpus = cpus.trim() ? Number(cpus) : null;
    if (parsedCpus !== original.cpus) patch.cpus = parsedCpus;

    const parsedMem = mem.trim() ? Number(mem) : null;
    if (parsedMem !== original.memory_mb) patch.memory_mb = parsedMem;

    if (network !== original.network) patch.network = network;

    const wdTrim = workdir.trim();
    if (wdTrim !== origWorkdir.trim() && wdTrim) patch.workdir = wdTrim;

    if (gpu !== origGpu) patch.gpu = gpu;
    const parsedVram = gpuVram.trim() ? Number(gpuVram) : null;
    if (parsedVram !== origGpuVram && parsedVram !== null) {
      patch.gpu_vram_mib = parsedVram;
    }

    const parsedStorage = storage.trim() ? Number(storage) : null;
    if (parsedStorage !== origStorage && parsedStorage !== null) {
      patch.storage_gib = parsedStorage;
    }
    const parsedOverlay = overlay.trim() ? Number(overlay) : null;
    if (parsedOverlay !== origOverlay && parsedOverlay !== null) {
      patch.overlay_gib = parsedOverlay;
    }

    // Volumes: diff by spec string.
    const origVolSpecs = new Set(original.mounts.map(volumeSpec));
    const currVolSpecs = new Set(volumes.map(volumeSpec));
    const addVols = volumes.filter(
      (v) =>
        v.host_path.trim() &&
        v.guest_path.trim() &&
        !origVolSpecs.has(volumeSpec(v)),
    );
    const removeVols = original.mounts
      .filter((v) => !currVolSpecs.has(volumeSpec(v)))
      .map(volumeSpec);
    if (addVols.length) patch.add_volumes = addVols;
    if (removeVols.length) patch.remove_volumes = removeVols;

    // Ports: diff by spec string.
    const origPortSpecs = new Set(original.ports.map(portSpec));
    const currPortSpecs = new Set(ports.map(portSpec));
    const validPorts = ports.filter(
      (p) =>
        Number.isFinite(p.host) &&
        Number.isFinite(p.guest) &&
        p.host > 0 &&
        p.guest > 0,
    );
    const addPorts = validPorts.filter((p) => !origPortSpecs.has(portSpec(p)));
    const removePorts = original.ports
      .filter((p) => !currPortSpecs.has(portSpec(p)))
      .map(portSpec);
    if (addPorts.length) patch.add_ports = addPorts;
    if (removePorts.length) patch.remove_ports = removePorts;

    // Env: diff by key. Add when key is new or value changed; remove
    // when an original key is absent from the current list.
    const invalid = envVars.find((e) => e.key.length > 0 && !isValidEnvKey(e.key));
    if (invalid) {
      setError(`Invalid env var name: "${invalid.key}"`);
      return null;
    }
    const cleanEnv = envVars
      .filter((e) => e.key.trim())
      .map((e) => ({ key: e.key.toUpperCase(), value: e.value }));
    const origByKey = new Map(origEnv.map((e) => [e.key.toUpperCase(), e.value]));
    const currByKey = new Map(cleanEnv.map((e) => [e.key, e.value]));
    const addEnv = cleanEnv.filter(
      (e) => origByKey.get(e.key) !== e.value,
    );
    const removeEnv: string[] = [];
    for (const k of origByKey.keys()) {
      if (!currByKey.has(k)) removeEnv.push(k);
    }
    if (addEnv.length) patch.add_env = addEnv;
    if (removeEnv.length) patch.remove_env = removeEnv;

    return patch;
  };

  const submit = async () => {
    setError(null);
    const patch = buildPatch();
    if (!patch) return;

    // No-op short-circuit.
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    try {
      await api.updateMachine(machine.name, patch);
      await refresh();
      onUpdated?.();
      onClose();
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Edit machine — {machine.name}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-fg-muted hover:bg-bg hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loadingInspect && (
            <div className="text-xs text-fg-muted">Loading current config…</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="CPUs">
              <input
                value={cpus}
                onChange={(e) => setCpus(e.target.value)}
                placeholder="4"
                inputMode="numeric"
                className="input"
              />
            </Field>
            <Field label="Memory (MiB)">
              <input
                value={mem}
                onChange={(e) => setMem(e.target.value)}
                placeholder="8192"
                inputMode="numeric"
                className="input"
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <Checkbox checked={network} onChange={setNetwork} label="Networking (--net)" />
            <Checkbox checked={gpu} onChange={setGpu} label="GPU" />
          </div>

          {gpu && (
            <Field label="GPU VRAM (MiB)" hint="optional">
              <input
                value={gpuVram}
                onChange={(e) => setGpuVram(e.target.value)}
                placeholder="2048"
                inputMode="numeric"
                className="input"
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Storage (GiB)" hint="root disk">
              <input
                value={storage}
                onChange={(e) => setStorage(e.target.value)}
                placeholder="leave empty to keep"
                inputMode="numeric"
                className="input"
              />
            </Field>
            <Field label="Overlay (GiB)">
              <input
                value={overlay}
                onChange={(e) => setOverlay(e.target.value)}
                placeholder="leave empty to keep"
                inputMode="numeric"
                className="input"
              />
            </Field>
          </div>

          <Field label="Working directory" hint="-w inside the VM">
            <input
              {...noAutoCorrect}
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              placeholder="/workspace"
              className="input font-mono"
            />
          </Field>

          <VolumeEditor volumes={volumes} onChange={setVolumes} />
          <PortEditor ports={ports} onChange={setPorts} />
          <EnvEditor env={envVars} onChange={setEnvVars} />

          {error && (
            <div className="rounded-md border border-stopped/40 bg-stopped/10 p-3 text-sm text-stopped">
              {error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-border bg-bg px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-card"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || loadingInspect}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
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

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border bg-bg accent-accent"
      />
      {label}
    </label>
  );
}

function VolumeEditor({
  volumes,
  onChange,
}: {
  volumes: VolumeMount[];
  onChange: (v: VolumeMount[]) => void;
}) {
  const add = () =>
    onChange([...volumes, { host_path: "", guest_path: "", readonly: false }]);
  const update = (i: number, patch: Partial<VolumeMount>) =>
    onChange(volumes.map((v, j) => (i === j ? { ...v, ...patch } : v)));
  const remove = (i: number) => onChange(volumes.filter((_, j) => j !== i));

  const browse = async (i: number) => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") update(i, { host_path: picked });
  };

  return (
    <Field label="Volume mounts">
      <div className="space-y-2">
        {volumes.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="flex flex-1 gap-1">
              <input
                {...noAutoCorrect}
                value={v.host_path}
                onChange={(e) => update(i, { host_path: e.target.value })}
                placeholder="/host/path"
                className="input flex-1 font-mono"
              />
              <button
                type="button"
                onClick={() => browse(i)}
                title="Browse"
                className="rounded-md border border-border bg-bg-card px-2 text-fg-muted hover:text-fg"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
            <span className="text-fg-muted">:</span>
            <input
              {...noAutoCorrect}
              value={v.guest_path}
              onChange={(e) => update(i, { guest_path: e.target.value })}
              placeholder="/guest/path"
              className="input flex-1 font-mono"
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={v.readonly}
                onChange={(e) => update(i, { readonly: e.target.checked })}
                className="h-3.5 w-3.5 accent-accent"
              />
              ro
            </label>
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remove"
              className="rounded-md p-1 text-fg-muted hover:bg-stopped/20 hover:text-stopped"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-fg-muted hover:border-accent/60 hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          Add mount
        </button>
      </div>
    </Field>
  );
}

function PortEditor({
  ports,
  onChange,
}: {
  ports: PortMapping[];
  onChange: (v: PortMapping[]) => void;
}) {
  const add = () =>
    onChange([...ports, { host: 0, guest: 0, protocol: "tcp" }]);
  const update = (i: number, patch: Partial<PortMapping>) =>
    onChange(ports.map((p, j) => (i === j ? { ...p, ...patch } : p)));
  const remove = (i: number) => onChange(ports.filter((_, j) => j !== i));

  return (
    <Field label="Port mappings">
      <div className="space-y-2">
        {ports.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={65535}
              value={p.host || ""}
              onChange={(e) => update(i, { host: Number(e.target.value) || 0 })}
              placeholder="host"
              className="input w-32 font-mono"
            />
            <span className="text-fg-muted">:</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={p.guest || ""}
              onChange={(e) => update(i, { guest: Number(e.target.value) || 0 })}
              placeholder="guest"
              className="input w-32 font-mono"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remove"
              className="ml-auto rounded-md p-1 text-fg-muted hover:bg-stopped/20 hover:text-stopped"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-fg-muted hover:border-accent/60 hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          Add port
        </button>
      </div>
    </Field>
  );
}

function EnvEditor({
  env,
  onChange,
}: {
  env: EnvVar[];
  onChange: (v: EnvVar[]) => void;
}) {
  const add = () => onChange([...env, { key: "", value: "" }]);
  const update = (i: number, patch: Partial<EnvVar>) =>
    onChange(env.map((e, j) => (i === j ? { ...e, ...patch } : e)));
  const remove = (i: number) => onChange(env.filter((_, j) => j !== i));

  return (
    <Field label="Environment variables">
      <div className="space-y-2">
        {env.map((e, i) => {
          const keyTouched = e.key.length > 0;
          const invalid = keyTouched && !isValidEnvKey(e.key);
          return (
            <div key={i}>
              <div className="flex items-center gap-1.5">
                <input
                  {...noAutoCorrect}
                  value={e.key}
                  onChange={(ev) => update(i, { key: ev.target.value.toUpperCase() })}
                  placeholder="KEY"
                  aria-invalid={invalid}
                  className={`input w-52 font-mono uppercase ${
                    invalid ? "border-stopped focus:border-stopped focus:ring-stopped" : ""
                  }`}
                />
                <span className="text-fg-muted">=</span>
                <input
                  {...noAutoCorrect}
                  value={e.value}
                  onChange={(ev) => update(i, { value: ev.target.value })}
                  placeholder="value"
                  className="input flex-1 font-mono"
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title="Remove"
                  className="rounded-md p-1 text-fg-muted hover:bg-stopped/20 hover:text-stopped"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {invalid && (
                <div className="mt-0.5 pl-1 text-[11px] text-stopped">
                  Must start with a letter or <code>_</code>, then letters, digits, or <code>_</code>.
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-fg-muted hover:border-accent/60 hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          Add variable
        </button>
      </div>
    </Field>
  );
}
