import type { MachineStatus } from "@/lib/types";

const STATUS_STYLES: Record<MachineStatus, { dot: string; label: string; text: string }> = {
  running: { dot: "bg-running", label: "Running", text: "text-running" },
  starting: { dot: "bg-starting", label: "Starting", text: "text-starting" },
  stopped: { dot: "bg-stopped", label: "Stopped", text: "text-stopped" },
  created: { dot: "bg-fg-muted", label: "Created", text: "text-fg-muted" },
  exited: { dot: "bg-fg-muted", label: "Exited", text: "text-fg-muted" },
  unreachable: { dot: "bg-starting", label: "Unreachable", text: "text-starting" },
  unknown: { dot: "bg-fg-muted", label: "Unknown", text: "text-fg-muted" },
};

export function StatusBadge({ status }: { status: MachineStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
      <span className={style.text}>{style.label}</span>
    </span>
  );
}
