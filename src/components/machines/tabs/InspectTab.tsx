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

  return (
    <div className="h-full overflow-auto p-6">
      <JsonTree data={data} />
    </div>
  );
}
