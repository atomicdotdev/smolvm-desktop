import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Play, Plus, RefreshCw, RotateCcw, Square, Trash2 } from "lucide-react";
import { useMachinesStore } from "@/hooks/useMachines";
import { useMachineDetailTab } from "@/hooks/useMachineDetailTab";
import { useNewMachineDialog } from "@/hooks/useNewMachineDialog";
import { getConfirmDestructive } from "@/components/settings/SettingsView";
import { StatusBadge } from "@/components/shared/Badge";
import type { Machine } from "@/lib/types";

interface Props {
  onSelect: (name: string) => void;
  filterImage?: string | null;
  onClearFilter?: () => void;
}

type NetworkFilter = "any" | "on" | "off";
const IMAGE_ALL = "__all__";

export function MachineList({ onSelect, filterImage, onClearFilter }: Props) {
  const { machines: allMachines, loading, error, lastFetched, refresh } =
    useMachinesStore();
  const [imageFilter, setImageFilter] = useState<string>(filterImage ?? IMAGE_ALL);
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>("any");

  // Keep local state in sync when the parent hands in a new filter (e.g. when
  // navigating from the Images tab).
  useEffect(() => {
    setImageFilter(filterImage ?? IMAGE_ALL);
  }, [filterImage]);

  const uniqueImages = useMemo(() => {
    const set = new Set<string>();
    for (const m of allMachines) if (m.image) set.add(m.image);
    return Array.from(set).sort();
  }, [allMachines]);

  const machines = allMachines.filter((m) => {
    if (imageFilter !== IMAGE_ALL && m.image !== imageFilter) return false;
    if (networkFilter === "on" && !m.network) return false;
    if (networkFilter === "off" && m.network) return false;
    return true;
  });

  const openDialog = useNewMachineDialog((s) => s.openDialog);
  const showRefreshing = useStickyFlag(loading, 600);

  const handleImageChange = (value: string) => {
    setImageFilter(value);
    if (value === IMAGE_ALL) onClearFilter?.();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-bg px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">Machines</h1>
          <p className="text-sm text-fg-muted">
            {countLabel(machines.length, allMachines.length)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refresh()}
            disabled={showRefreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70 disabled:opacity-70"
          >
            <RefreshCw
              className={`h-4 w-4 ${showRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
          <button
            onClick={() => openDialog()}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            New machine
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-stopped/40 bg-stopped/10 px-6 py-3 text-sm text-stopped">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 border-b border-border bg-bg/60 px-6 py-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-fg-muted">Filter</span>
        <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
          Image
          <select
            value={imageFilter}
            onChange={(e) => handleImageChange(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
          >
            <option value={IMAGE_ALL}>All</option>
            {uniqueImages.map((img) => (
              <option key={img} value={img}>
                {img}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
          Network
          <select
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value as NetworkFilter)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
          >
            <option value="any">Any</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
        {(imageFilter !== IMAGE_ALL || networkFilter !== "any") && (
          <button
            onClick={() => {
              setImageFilter(IMAGE_ALL);
              setNetworkFilter("any");
              onClearFilter?.();
            }}
            className="text-xs text-accent hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <TableBody
          machines={machines}
          totalCount={allMachines.length}
          lastFetched={lastFetched}
          onSelect={onSelect}
          onNew={() => openDialog()}
        />
      </div>

    </div>
  );
}

function countLabel(filtered: number, total: number): string {
  if (total === 0) return "No machines yet";
  if (filtered === total) return `${total} machine${total === 1 ? "" : "s"}`;
  return `${filtered} of ${total} machines`;
}

function TableBody({
  machines,
  totalCount,
  lastFetched,
  onSelect,
  onNew,
}: {
  machines: Machine[];
  totalCount: number;
  lastFetched: number | null;
  onSelect: (name: string) => void;
  onNew: () => void;
}) {
  if (machines.length > 0) {
    return (
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-bg text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr className="border-b border-border">
            <th className="px-6 py-3 font-medium">Status</th>
            <th className="px-6 py-3 font-medium">Name</th>
            <th className="px-6 py-3 font-medium">Image</th>
            <th className="px-6 py-3 font-medium">Network</th>
            <th className="px-6 py-3 font-medium">Ports</th>
            <th className="px-6 py-3 font-medium">Env</th>
            <th className="px-6 py-3 font-medium">PID</th>
            <th className="px-6 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <MachineRow key={m.name} machine={m} onOpen={() => onSelect(m.name)} />
          ))}
        </tbody>
      </table>
    );
  }
  // First fetch hasn't completed — don't flash an empty state.
  if (lastFetched === null) return null;
  if (totalCount === 0) return <EmptyState onNew={onNew} />;
  return (
    <div className="flex h-full items-center justify-center p-12 text-sm text-fg-muted">
      No machines match the current filter.
    </div>
  );
}

/**
 * Keeps a flag visually "on" for at least `minMs` once raised, so quick flickers
 * from background polling still produce a smooth spinner cycle.
 */
function useStickyFlag(active: boolean, minMs: number): boolean {
  const [show, setShow] = useState(active);
  useEffect(() => {
    if (active) {
      setShow(true);
      return undefined;
    }
    const t = setTimeout(() => setShow(false), minMs);
    return () => clearTimeout(t);
  }, [active, minMs]);
  return show;
}

function MachineRow({
  machine,
  onOpen,
}: {
  machine: Machine;
  onOpen: () => void;
}) {
  const { start, stop, remove } = useMachinesStore();
  const setPendingTab = useMachineDetailTab((s) => s.set);
  const pending = useMachinesStore((s) => s.pending[machine.name]);
  const running = machine.status === "running" || machine.status === "starting";
  const busy = pending !== undefined;

  const stopClick = (e: React.MouseEvent) => e.stopPropagation();

  const confirmDelete = () => {
    if (getConfirmDestructive() && !confirm(`Delete machine "${machine.name}"?`)) return;
    remove(machine.name);
  };

  // Start is the long-running case (init commands may take minutes). Pre-set
  // the Logs tab and navigate into the machine so the user lands on streaming
  // output immediately.
  const startAndOpen = () => {
    setPendingTab(machine.name, "logs");
    onOpen();
    void start(machine.name);
  };

  const toggle = running
    ? { title: "Stop", label: "Stopping…", icon: <Square className="h-4 w-4" />, onClick: () => stop(machine.name), kind: "stop" as const }
    : { title: "Start", label: "Starting…", icon: <Play className="h-4 w-4" />, onClick: startAndOpen, kind: "start" as const };

  return (
    <tr
      onClick={onOpen}
      className="group cursor-pointer border-b border-border/60 hover:bg-bg-card/40"
    >
      <td className="px-6 py-3">
        <StatusBadge status={machine.status} />
      </td>
      <td className="px-6 py-3 font-medium">
        <span className="inline-flex items-center gap-1.5">
          {machine.name}
          <ChevronRight className="h-3.5 w-3.5 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      </td>
      <td className="px-6 py-3 text-fg-muted">{machine.image ?? "—"}</td>
      <td className="px-6 py-3 text-fg-muted">{machine.network ? "on" : "off"}</td>
      <td className="px-6 py-3 text-fg-muted">{formatPorts(machine.ports)}</td>
      <td className="px-6 py-3 font-mono text-xs text-fg-muted">
        {machine.env_count > 0 ? machine.env_count : "—"}
      </td>
      <td className="px-6 py-3 font-mono text-xs text-fg-muted">
        {machine.pid ?? "—"}
      </td>
      <td className="px-6 py-3" onClick={stopClick}>
        <div className="flex justify-end gap-1">
          <ActionIcon
            title={toggle.title}
            pendingLabel={toggle.label}
            busy={busy}
            active={pending === toggle.kind}
            icon={toggle.icon}
            onClick={toggle.onClick}
          />
          <ActionIcon
            title="Restart"
            busy={busy}
            active={false}
            disabled={!running}
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={async () => {
              setPendingTab(machine.name, "logs");
              onOpen();
              await stop(machine.name);
              await start(machine.name);
            }}
          />
          <ActionIcon
            title="Delete"
            pendingLabel="Deleting…"
            busy={busy}
            active={pending === "delete"}
            destructive
            icon={<Trash2 className="h-4 w-4" />}
            onClick={confirmDelete}
          />
        </div>
      </td>
    </tr>
  );
}

function formatPorts(ports: Machine["ports"]): string {
  if (ports.length === 0) return "—";
  return ports.map((p) => `${p.host}:${p.guest}/${p.protocol}`).join(", ");
}

function ActionIcon({
  title,
  pendingLabel,
  icon,
  busy,
  active,
  destructive,
  disabled,
  onClick,
}: {
  title: string;
  pendingLabel?: string;
  icon: React.ReactNode;
  busy: boolean;
  active: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const label = active && pendingLabel ? pendingLabel : title;
  const rendered = active ? <Loader2 className="h-4 w-4 animate-spin" /> : icon;
  return (
    <IconBtn
      title={label}
      onClick={onClick}
      disabled={busy || disabled}
      destructive={destructive}
      icon={rendered}
    />
  );
}

function IconBtn({
  title,
  onClick,
  icon,
  destructive,
  disabled,
}: {
  title: string;
  onClick: () => void;
  icon: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md p-1.5 text-fg-muted transition-colors ${
        disabled
          ? "opacity-40"
          : destructive
            ? "hover:bg-stopped/20 hover:text-stopped"
            : "hover:bg-bg-card hover:text-fg"
      }`}
    >
      {icon}
    </button>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center text-fg-muted">
      <p className="text-base">No machines yet.</p>
      <button
        onClick={onNew}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
      >
        <Plus className="h-4 w-4" />
        Create your first machine
      </button>
    </div>
  );
}
