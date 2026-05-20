import { useEffect, useState } from "react";
import { api } from "@/lib/invoke";
import { JsonTree } from "@/components/shared/JsonTree";

export function InspectTab({ name }: { name: string }) {
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .inspectMachine(name)
      .then((r) => {
        if (alive) setData(r.raw);
      })
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [name]);

  if (err) return <div className="p-6 text-sm text-stopped">{err}</div>;
  if (!data) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;

  const gpu = readGpu(data);

  return (
    <div className="h-full overflow-auto p-6">
      {gpu.enabled && (
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
            GPU
            {gpu.vramMib != null && (
              <span className="text-accent/70">· {gpu.vramMib} MiB</span>
            )}
          </span>
        </div>
      )}
      <JsonTree data={data} />
    </div>
  );
}

/**
 * Pull GPU config from the raw `machine ls --json` entry. The smolvm CLI's
 * field naming for GPU isn't pinned, so we accept a few common spellings.
 */
function readGpu(raw: unknown): { enabled: boolean; vramMib: number | null } {
  if (!raw || typeof raw !== "object") return { enabled: false, vramMib: null };
  const obj = raw as Record<string, unknown>;
  const enabled =
    obj.gpu === true ||
    (typeof obj.gpu === "object" && obj.gpu !== null) ||
    obj.gpu_enabled === true ||
    obj.gpuEnabled === true;
  const vramRaw =
    obj.gpu_vram_mib ??
    obj.gpuVramMib ??
    obj.gpu_vram ??
    (typeof obj.gpu === "object" && obj.gpu !== null
      ? (obj.gpu as Record<string, unknown>).vram_mib ??
        (obj.gpu as Record<string, unknown>).vramMib
      : undefined);
  const vramMib =
    typeof vramRaw === "number" && Number.isFinite(vramRaw) ? vramRaw : null;
  return { enabled, vramMib };
}
