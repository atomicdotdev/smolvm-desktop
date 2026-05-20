import { open } from "@tauri-apps/plugin-shell";
import { ExternalLink } from "lucide-react";
import type { Machine } from "@/lib/types";

export function PortsTab({ machine }: { machine: Machine }) {
  if (machine.ports.length === 0) {
    return (
      <div className="p-6 text-sm text-fg-muted">
        No ports mapped. Add <code className="rounded bg-bg-card px-1">-p HOST:GUEST</code>{" "}
        when creating the machine.
      </div>
    );
  }

  return (
    <div className="p-6">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr className="border-b border-border">
            <th className="py-2 font-medium">Host</th>
            <th className="py-2 font-medium">Guest</th>
            <th className="py-2 font-medium">Protocol</th>
            <th className="py-2 font-medium">Open</th>
          </tr>
        </thead>
        <tbody>
          {machine.ports.map((p, i) => {
            const url = `http://localhost:${p.host}`;
            const canOpen = p.protocol.toLowerCase() === "tcp";
            return (
              <tr key={i} className="border-b border-border/60">
                <td className="py-2 font-mono">{p.host}</td>
                <td className="py-2 font-mono">{p.guest}</td>
                <td className="py-2 uppercase text-fg-muted">{p.protocol}</td>
                <td className="py-2">
                  {canOpen ? (
                    <button
                      onClick={() => open(url)}
                      className="inline-flex items-center gap-1.5 text-accent hover:underline"
                    >
                      {url}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <span className="text-fg-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
