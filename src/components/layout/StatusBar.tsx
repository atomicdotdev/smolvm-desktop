import { useHealthStore } from "@/hooks/useHealth";
import { useMachinesStore } from "@/hooks/useMachines";

interface Props {
  onOpenSettings?: () => void;
}

export function StatusBar({ onOpenSettings }: Props) {
  const health = useHealthStore((s) => s.health);
  const machines = useMachinesStore((s) => s.machines);

  const running = machines.filter((m) => m.status === "running").length;
  const total = machines.length;

  const engineColor = !health
    ? "bg-fg-muted"
    : health.healthy
      ? "bg-running"
      : "bg-stopped";
  const engineLabel = !health
    ? "Checking…"
    : health.healthy
      ? "Engine: on"
      : "Engine: off";

  return (
    <div className="flex items-center justify-between border-t border-border bg-bg-sidebar px-4 py-2 text-xs text-fg-muted">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${engineColor}`} />
        <span>{engineLabel}</span>
        {health?.version && (
          <button
            onClick={onOpenSettings}
            title="Open smolvm settings"
            className="text-fg-muted/70 hover:text-fg hover:underline"
          >
            · {health.version}
          </button>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span>
          Machines: <span className="text-fg">{running}</span> running / {total} total
        </span>
      </div>
    </div>
  );
}
