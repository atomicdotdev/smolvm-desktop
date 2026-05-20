import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/invoke";
import type { MachineStats } from "@/lib/types";
import { Sparkline, formatBytes } from "@/components/shared/Sparkline";

const WINDOW_POINTS = 150; // 150 samples × 2s = 5 min
const POLL_MS = 2000;

export function StatsTab({ name, running }: { name: string; running: boolean }) {
  const [samples, setSamples] = useState<MachineStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!running) {
      setSamples([]);
      return () => {
        mounted.current = false;
      };
    }

    let timer: number | null = null;
    const tick = async () => {
      try {
        const s = await api.machineStats(name);
        if (!mounted.current) return;
        setSamples((prev) => {
          const next = [...prev, s];
          if (next.length > WINDOW_POINTS) next.splice(0, next.length - WINDOW_POINTS);
          return next;
        });
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
  }, [name, running]);

  const latest = samples[samples.length - 1];

  if (!running) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
        Start the machine to sample its host process.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      {error && (
        <div className="rounded border border-stopped/40 bg-stopped/10 p-3 text-sm text-stopped">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card
          label="CPU"
          value={latest ? `${latest.cpu_percent.toFixed(1)}%` : "—"}
          hint={latest ? `sampled ${samples.length} time${samples.length === 1 ? "" : "s"}` : ""}
        >
          <Sparkline
            points={samples.map((s) => s.cpu_percent)}
            max={Math.max(100, ...samples.map((s) => s.cpu_percent))}
            color="#4c7bf4"
          />
        </Card>
        <Card
          label="Memory (RSS)"
          value={latest ? formatBytes(latest.memory_bytes) : "—"}
          hint="host-observed resident set size"
        >
          <Sparkline
            points={samples.map((s) => s.memory_bytes)}
            color="#34d399"
          />
        </Card>
      </div>

      <div className="rounded-md border border-border bg-bg-card/40 p-3 text-xs text-fg-muted">
        Stats are sampled host-side from the vmm process tree by PID. smolvm doesn&apos;t
        expose guest-level metrics (balloon actual, disk I/O, network throughput) yet —
        numbers here track the whole VM process, not what the guest reports internally.
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-card p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
        {hint && <div className="text-[10px] text-fg-muted/70">{hint}</div>}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
