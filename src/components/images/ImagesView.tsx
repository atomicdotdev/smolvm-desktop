import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "@/lib/invoke";
import type { ImageEntry, Machine, PruneResult } from "@/lib/types";
import { useMachinesStore } from "@/hooks/useMachines";
import { useErrorModal } from "@/hooks/useErrorModal";
import { useToastsStore } from "@/hooks/useToasts";

export function ImagesView({
  onViewMachines,
}: {
  onViewMachines: (name: string) => void;
}) {
  const machines = useMachinesStore((s) => s.machines);
  // Only machines with an image reference are candidates for a layer cache.
  const candidates = useMemo(
    () => machines.filter((m) => m.image && m.image.length > 0),
    [machines],
  );

  const [selected, setSelected] = useState<string | null>(null);

  // Auto-select first candidate when nothing is selected (or selection vanished).
  useEffect(() => {
    if (selected && candidates.some((m) => m.name === selected)) return;
    setSelected(candidates[0]?.name ?? null);
  }, [candidates, selected]);

  return (
    <div className="flex h-full">
      <MachinePicker
        machines={candidates}
        selected={selected}
        onSelect={setSelected}
      />
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <MachineImagePanel
            key={selected}
            name={selected}
            onViewMachine={() => onViewMachines(selected)}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function MachinePicker({
  machines,
  selected,
  onSelect,
}: {
  machines: Machine[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-bg-card/30">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Machines
        </h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          {machines.length === 0
            ? "No image-backed machines"
            : `${machines.length} with cached layers`}
        </p>
      </div>
      <ul className="flex-1 overflow-auto py-1">
        {machines.map((m) => {
          const active = m.name === selected;
          return (
            <li key={m.name}>
              <button
                onClick={() => onSelect(m.name)}
                className={`flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left text-sm transition-colors ${
                  active
                    ? "bg-accent/15 text-fg"
                    : "text-fg-muted hover:bg-bg-card/70 hover:text-fg"
                }`}
              >
                <span className="font-medium text-fg">{m.name}</span>
                <span className="truncate font-mono text-xs text-fg-muted">
                  {m.image}
                </span>
              </button>
            </li>
          );
        })}
        {machines.length === 0 && (
          <li className="px-4 py-3 text-xs text-fg-muted">
            Create a machine with an image to populate this view.
          </li>
        )}
      </ul>
    </aside>
  );
}

function MachineImagePanel({
  name,
  onViewMachine,
}: {
  name: string;
  onViewMachine: () => void;
}) {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prune, setPrune] = useState<PruneSession | null>(null);

  // smolvm refuses to prune layers (or `--all`) while the machine is running.
  // Disable the buttons in that case so we don't show a guaranteed-failing UI.
  const running = useMachinesStore(
    (s) => s.machines.find((m) => m.name === name)?.status === "running",
  );
  const pruneDisabledReason = running
    ? "Stop the machine before pruning."
    : undefined;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listMachineImages(name);
      setEntries(list);
      setError(null);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalBytes = useMemo(
    () =>
      entries.reduce(
        (acc, e) => acc + (typeof e.size_bytes === "number" ? e.size_bytes : 0),
        0,
      ),
    [entries],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-bg px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{name}</h1>
            <button
              onClick={onViewMachine}
              className="rounded-md border border-border bg-bg-card px-2 py-0.5 text-xs text-fg-muted hover:bg-bg-card/70 hover:text-fg"
            >
              Open machine
            </button>
          </div>
          <p className="text-sm text-fg-muted">
            {entries.length === 0
              ? "No cached layers"
              : `${entries.length} ${entries.length === 1 ? "layer" : "layers"}${
                  totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : ""
                }`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setPrune({ name, all: false, phase: "confirm" })}
            disabled={running}
            title={pruneDisabledReason}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-bg-card"
          >
            <Trash2 className="h-4 w-4" />
            Prune
          </button>
          <button
            onClick={() => setPrune({ name, all: true, phase: "confirm" })}
            disabled={running}
            title={pruneDisabledReason}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
          >
            <Trash2 className="h-4 w-4" />
            Prune all unused
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-stopped/40 bg-stopped/10 px-6 py-3 text-sm text-stopped">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {entries.length === 0 && !loading && !error ? (
          <div className="flex h-full items-center justify-center p-12 text-sm text-fg-muted">
            No cached layers reported for this machine.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr className="border-b border-border">
                <th className="px-6 py-3 font-medium">Digest</th>
                <th className="px-6 py-3 font-medium">Reference</th>
                <th className="px-6 py-3 font-medium">Size</th>
                <th className="px-6 py-3 font-medium">Created</th>
                <th className="px-6 py-3 font-medium">In use</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr
                  key={(e.digest ?? "") + ":" + i}
                  className="border-b border-border/60 hover:bg-bg-card/40"
                >
                  <td className="px-6 py-3 font-mono text-xs">
                    <span className="inline-flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5 text-accent" />
                      <span className="break-all">
                        {e.digest ?? <RawFallback raw={e.raw} keys={["digest", "id"]} />}
                      </span>
                    </span>
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-fg-muted">
                    {e.reference ?? <RawFallback raw={e.raw} keys={["reference", "ref", "image"]} />}
                  </td>
                  <td className="px-6 py-3 text-fg-muted">
                    {typeof e.size_bytes === "number"
                      ? formatBytes(e.size_bytes)
                      : "—"}
                  </td>
                  <td className="px-6 py-3 text-fg-muted">
                    {e.created ?? "—"}
                  </td>
                  <td className="px-6 py-3 text-xs">
                    {e.in_use === true ? (
                      <span className="text-running">in use</span>
                    ) : e.in_use === false ? (
                      <span className="text-fg-muted">unused</span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {prune && (
        <PruneDialog
          session={prune}
          onClose={() => setPrune(null)}
          onDone={() => {
            setPrune(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * Fallback that scans the raw JSON for the first present key. Useful when the
 * smolvm JSON shape uses keys we didn't anticipate in the Rust shim.
 */
function RawFallback({ raw, keys }: { raw: unknown; keys: string[] }) {
  if (!raw || typeof raw !== "object") return <span>—</span>;
  const obj = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return <span>{v}</span>;
  }
  return <span>—</span>;
}

interface PruneSession {
  name: string;
  all: boolean;
  phase: "confirm" | "dry-running" | "previewed" | "running" | "done";
  preview?: PruneResult;
  result?: PruneResult;
}

function PruneDialog({
  session,
  onClose,
  onDone,
}: {
  session: PruneSession;
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<PruneSession>(session);
  const [error, setError] = useState<string | null>(null);
  const showError = useErrorModal((s) => s.show);
  const pushToast = useToastsStore((s) => s.push);

  const runDryRun = useCallback(async () => {
    setError(null);
    setState((s) => ({ ...s, phase: "dry-running" }));
    try {
      const preview = await api.pruneMachineImages(state.name, state.all, true);
      setState((s) => ({ ...s, phase: "previewed", preview }));
    } catch (e) {
      setError(String(e));
      setState((s) => ({ ...s, phase: "confirm" }));
    }
  }, [state.name, state.all]);

  // Auto-kick off the dry-run on open.
  useEffect(() => {
    if (state.phase === "confirm") {
      runDryRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runForReal = useCallback(async () => {
    setError(null);
    setState((s) => ({ ...s, phase: "running" }));
    try {
      const result = await api.pruneMachineImages(state.name, state.all, false);
      setState((s) => ({ ...s, phase: "done", result }));
      const freed =
        typeof result.reclaimed_bytes === "number"
          ? ` (${formatBytes(result.reclaimed_bytes)} reclaimed)`
          : "";
      pushToast("success", `Pruned "${state.name}"${freed}`);
      // brief pause so user sees the final output, then close.
      setTimeout(onDone, 600);
    } catch (e) {
      showError(`Prune "${state.name}" failed`, e);
      onClose();
    }
  }, [state.name, state.all, onClose, onDone, pushToast, showError]);

  const heading = state.all
    ? `Prune all unused layers (${state.name})`
    : `Prune layers for ${state.name}`;

  const busy = state.phase === "dry-running" || state.phase === "running";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">{heading}</h2>
            <p className="text-xs text-fg-muted">
              {state.phase === "confirm" || state.phase === "dry-running"
                ? "Previewing with --dry-run…"
                : state.phase === "previewed"
                ? "Dry-run preview. Confirm to actually delete."
                : state.phase === "running"
                ? "Pruning…"
                : "Done."}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-bg hover:text-fg disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-auto bg-bg/40">
          {error && (
            <div className="m-5 rounded-md border border-stopped/40 bg-stopped/10 p-3 text-sm text-stopped">
              {error}
            </div>
          )}
          <pre className="whitespace-pre-wrap break-all p-5 font-mono text-xs leading-5 text-fg-term">
            {(state.result ?? state.preview)?.output ??
              (state.phase === "dry-running" ? "Running dry-run…" : "")}
          </pre>
          {(state.result ?? state.preview) && (
            <PruneSummary res={(state.result ?? state.preview)!} />
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-bg px-5 py-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70 disabled:opacity-40"
          >
            {state.phase === "done" ? "Close" : "Cancel"}
          </button>
          {state.phase === "previewed" && (
            <button
              onClick={runForReal}
              className="inline-flex items-center gap-1.5 rounded-md bg-stopped px-4 py-1.5 text-sm font-medium text-white hover:bg-stopped/90"
            >
              <Trash2 className="h-4 w-4" />
              Prune for real
            </button>
          )}
          {state.phase === "running" && (
            <span className="px-3 py-1.5 text-sm text-fg-muted">Pruning…</span>
          )}
        </footer>
      </div>
    </div>
  );
}

function PruneSummary({ res }: { res: PruneResult }) {
  if (res.removed_count === null && res.reclaimed_bytes === null) return null;
  return (
    <div className="mx-5 mb-5 rounded-md border border-border bg-bg-card/60 p-3 text-xs text-fg-muted">
      {res.removed_count !== null && (
        <div>
          {res.dry_run ? "Would remove" : "Removed"}:{" "}
          <span className="font-mono text-fg">{res.removed_count}</span>
        </div>
      )}
      {res.reclaimed_bytes !== null && (
        <div>
          {res.dry_run ? "Would reclaim" : "Reclaimed"}:{" "}
          <span className="font-mono text-fg">
            {formatBytes(res.reclaimed_bytes)}
          </span>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center text-fg-muted">
      <Layers className="h-10 w-10 text-fg-muted/60" />
      <p className="text-base">No image-backed machines.</p>
      <p className="max-w-md text-sm">
        Create a machine with an image (e.g.{" "}
        <code className="rounded bg-bg-card px-1 font-mono text-xs">
          --image ubuntu:24.04
        </code>
        ) to see its cached layers and free disk space here.
      </p>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
