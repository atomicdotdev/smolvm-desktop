import { useEffect, useState } from "react";
import { ArrowLeft, Check, Copy, Loader2, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import type { Machine } from "@/lib/types";
import { useMachinesStore } from "@/hooks/useMachines";
import { useMachineDetailTab } from "@/hooks/useMachineDetailTab";
import { getConfirmDestructive } from "@/components/settings/SettingsView";
import { StatusBadge } from "@/components/shared/Badge";
import { Tabs } from "@/components/shared/Tabs";
import { InspectTab } from "./tabs/InspectTab";
import { PortsTab } from "./tabs/PortsTab";
import { LogsTab } from "./tabs/LogsTab";
import { ExecTab } from "./tabs/ExecTab";
import { FilesTab } from "./tabs/FilesTab";
import { RunTab } from "./tabs/RunTab";
import { StatsTab } from "./tabs/StatsTab";

interface Props {
  machine: Machine;
  onBack: () => void;
}

const TABS = [
  { id: "logs", label: "Logs" },
  { id: "inspect", label: "Inspect" },
  { id: "exec", label: "Exec" },
  { id: "run", label: "Run" },
  { id: "files", label: "Files" },
  { id: "ports", label: "Ports" },
  { id: "stats", label: "Stats" },
];

export function MachineDetail({ machine, onBack }: Props) {
  const [tab, setTab] = useState("logs");
  const pendingTab = useMachineDetailTab((s) => s.pending);
  const clearPendingTab = useMachineDetailTab((s) => s.clear);

  useEffect(() => {
    setTab("logs");
  }, [machine.name]);

  useEffect(() => {
    if (pendingTab && pendingTab.name === machine.name) {
      setTab(pendingTab.tab);
      clearPendingTab();
    }
  }, [pendingTab, machine.name, clearPendingTab]);

  const { start, stop, remove } = useMachinesStore();
  const pending = useMachinesStore((s) => s.pending[machine.name]);
  const running = machine.status === "running" || machine.status === "starting";
  const busy = pending !== undefined;
  const Spinner = <Loader2 className="h-4 w-4 animate-spin" />;

  const handleDelete = () => {
    if (getConfirmDestructive() && !confirm(`Delete machine "${machine.name}"?`)) return;
    remove(machine.name).then(onBack);
  };

  const toggle = running
    ? {
        label: pending === "stop" ? "Stopping…" : "Stop",
        icon: pending === "stop" ? Spinner : <Square className="h-4 w-4" />,
        onClick: () => stop(machine.name),
      }
    : {
        label: pending === "start" ? "Starting…" : "Start",
        icon: pending === "start" ? Spinner : <Play className="h-4 w-4" />,
        onClick: () => start(machine.name),
      };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border bg-bg px-6 py-4">
        <button
          onClick={onBack}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
          Machines
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CopyableName name={machine.name} />
            <div className="mt-1 flex items-center gap-3 text-sm text-fg-muted">
              <StatusBadge status={machine.status} />
              {machine.image && <span>· {machine.image}</span>}
              {machine.pid !== null && (
                <span className="font-mono text-xs">· PID {machine.pid}</span>
              )}
              <span>· network {machine.network ? "on" : "off"}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <ActionBtn
              icon={toggle.icon}
              label={toggle.label}
              onClick={toggle.onClick}
              disabled={busy}
            />
            <ActionBtn
              icon={<RotateCcw className="h-4 w-4" />}
              label="Restart"
              disabled={!running || busy}
              onClick={async () => {
                await stop(machine.name);
                await start(machine.name);
              }}
            />
            <ActionBtn
              icon={pending === "delete" ? Spinner : <Trash2 className="h-4 w-4" />}
              label={pending === "delete" ? "Deleting…" : "Delete"}
              destructive
              disabled={busy}
              onClick={handleDelete}
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <Tabs tabs={TABS} active={tab} onChange={setTab}>
          {tab === "logs" && <LogsTab name={machine.name} />}
          {tab === "inspect" && <InspectTab name={machine.name} />}
          {tab === "exec" && <ExecTab name={machine.name} running={running} />}
          {tab === "run" && <RunTab name={machine.name} running={running} />}
          {tab === "files" && <FilesTab name={machine.name} running={running} />}
          {tab === "ports" && <PortsTab machine={machine} />}
          {tab === "stats" && <StatsTab name={machine.name} running={running} />}
        </Tabs>
      </div>
    </div>
  );
}

function CopyableName({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
    } catch {
      // Clipboard can fail silently in some contexts; don't break the UI.
    }
  };

  return (
    <button
      onClick={copy}
      title="Click to copy machine name"
      className="group inline-flex items-center gap-2 text-xl font-semibold hover:text-accent"
    >
      {name}
      {copied ? (
        <Check className="h-4 w-4 text-running" />
      ) : (
        <Copy className="h-4 w-4 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  destructive,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors ${
        disabled
          ? "opacity-40"
          : destructive
            ? "hover:border-stopped/60 hover:bg-stopped/10 hover:text-stopped"
            : "bg-bg-card hover:bg-bg-card/70"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
