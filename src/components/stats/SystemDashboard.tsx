import { useEffect, useRef, useState } from "react";
import { Cpu, MemoryStick } from "lucide-react";
import { api } from "@/lib/invoke";
import type { SystemStats } from "@/lib/types";
import { Sparkline, formatBytes } from "@/components/shared/Sparkline";

const WINDOW_POINTS = 150;
const POLL_MS = 2000;

export function SystemDashboard() {
  const [latest, setLatest] = useState<SystemStats | null>(null);
  const [cpuSeries, setCpuSeries] = useState<number[]>([]);
  const [memSeries, setMemSeries] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const s = await api.systemStats();
        if (!mounted.current) return;
        setLatest(s);
        setCpuSeries((prev) => roll(prev, s.total_cpu_percent));
        setMemSeries((prev) => roll(prev, s.total_memory_bytes));
        setError(null);
      } catch (e) {
        if (mounted.current) setError(String(e));
      } finally {
        if (mounted.current) timer = window.setTimeout(tick, POLL_MS);
      }
    };
    tick();

    return () => {
      mounted.current = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  const sortedMachines = latest
    ? [...latest.per_machine].sort((a, b) => b.memory_bytes - a.memory_bytes)
    : [];

  const hostCpuCapacity = (latest?.host_cpu_count ?? 1) * 100;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border bg-bg px-6 py-4">
        <h1 className="text-xl font-semibold">System</h1>
        <p className="text-sm text-fg-muted">
          Host-side resource usage across all running smolvm machines
        </p>
      </header>

      {error && (
        <div className="border-b border-stopped/40 bg-stopped/10 px-6 py-3 text-sm text-stopped">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            icon={<Cpu className="h-4 w-4" />}
            label="CPU"
            value={latest ? `${latest.total_cpu_percent.toFixed(1)}%` : "—"}
            hint={
              latest
                ? `across ${latest.per_machine.length} running VM${latest.per_machine.length === 1 ? "" : "s"} · host has ${latest.host_cpu_count} cores`
                : ""
            }
          >
            <Sparkline points={cpuSeries} max={hostCpuCapacity} color="#4c7bf4" />
          </Card>
          <Card
            icon={<MemoryStick className="h-4 w-4" />}
            label="Memory"
            value={latest ? formatBytes(latest.total_memory_bytes) : "—"}
            hint={
              latest
                ? `of ${formatBytes(latest.host_memory_total_bytes)} host total`
                : ""
            }
          >
            <Sparkline
              points={memSeries}
              max={latest?.host_memory_total_bytes ?? undefined}
              color="#34d399"
            />
          </Card>
        </div>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Running machines
          </h2>
          {sortedMachines.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
              No running machines.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr className="border-b border-border">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">PID</th>
                  <th className="py-2 font-medium">CPU</th>
                  <th className="py-2 font-medium">Memory</th>
                </tr>
              </thead>
              <tbody>
                {sortedMachines.map((m) => (
                  <tr key={m.name} className="border-b border-border/60">
                    <td className="py-2">{m.name}</td>
                    <td className="py-2 font-mono text-xs text-fg-muted">
                      {m.pid ?? "—"}
                    </td>
                    <td className="py-2 font-mono">{m.cpu_percent.toFixed(1)}%</td>
                    <td className="py-2 font-mono">{formatBytes(m.memory_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function Card({
  icon,
  label,
  value,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-fg-muted">{hint}</div>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function roll(prev: number[], next: number): number[] {
  const out = [...prev, next];
  if (out.length > WINDOW_POINTS) out.splice(0, out.length - WINDOW_POINTS);
  return out;
}
