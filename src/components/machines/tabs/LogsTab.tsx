import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ArrowDownToLine, Search } from "lucide-react";

interface LogLine {
  raw: string;
  timestamp?: string;
  level?: string;
  message?: string;
  target?: string;
}

const MAX_LINES = 5000;

function parseLine(raw: string): LogLine {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const fields = (o.fields as Record<string, unknown> | undefined) ?? {};
    const message =
      (fields.message as string | undefined) ?? (o.message as string | undefined);
    return {
      raw,
      timestamp: o.timestamp as string | undefined,
      level: o.level as string | undefined,
      message,
      target: o.target as string | undefined,
    };
  } catch {
    return { raw };
  }
}

const LEVEL_COLOR: Record<string, string> = {
  ERROR: "text-stopped",
  WARN: "text-starting",
  INFO: "text-running",
  DEBUG: "text-fg-muted",
  TRACE: "text-fg-muted/70",
};

export function LogsTab({ name }: { name: string }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [query, setQuery] = useState("");
  const [initialized, setInitialized] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      try {
        const snapshot = await invoke<string[]>("machine_log_snapshot", {
          name,
          tail: 500,
        });
        if (cancelled) return;
        setLines(snapshot.map(parseLine));
        setInitialized(true);

        unlisten = await listen<string>(`agent-log-${name}`, (event) => {
          const parsed = parseLine(event.payload);
          setLines((prev) => {
            const next = [...prev, parsed];
            if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
            return next;
          });
        });

        await invoke("machine_log_follow", { name });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      invoke("machine_log_stop", { name }).catch(() => {});
    };
  }, [name]);

  const filtered = useMemo(() => {
    if (!query.trim()) return lines;
    const q = query.toLowerCase();
    return lines.filter((l) => l.raw.toLowerCase().includes(q));
  }, [lines, query]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [filtered, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Near-bottom threshold accommodates sub-pixel rounding and a line of slack.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(nearBottom);
  };

  return (
    <div className="flex h-full flex-col bg-bg-term">
      <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter logs"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-md border border-border bg-bg py-1 pl-7 pr-2 text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex-1 text-xs text-fg-muted">
          {filtered.length} / {lines.length} lines · agent-console.log
        </div>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3.5 w-3.5 accent-accent"
          />
          Auto-scroll
        </label>
        <button
          onClick={() => bottomRef.current?.scrollIntoView({ block: "end" })}
          title="Scroll to bottom"
          className="rounded-md p-1 text-fg-muted hover:bg-bg-card hover:text-fg"
        >
          <ArrowDownToLine className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-5 text-fg-term"
      >
        {error && (
          <div className="mb-2 rounded border border-stopped/40 bg-stopped/10 p-2 text-stopped">
            {error}
          </div>
        )}
        {initialized && lines.length === 0 && (
          <div className="px-2 py-4 text-fg-muted">
            No log yet. Start the machine to populate <code>agent-console.log</code>.
          </div>
        )}
        {filtered.map((l, i) => (
          <LogRow key={i} line={l} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border bg-bg px-4 py-1.5 text-[11px] text-fg-muted">
        Showing smolvm agent logs (boot / mount / exec / shutdown). User-process stdout is
        not yet exposed by SmolVM.
      </div>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  if (!line.message) {
    return (
      <div className="whitespace-pre-wrap break-all text-fg-muted/70">
        {line.raw}
      </div>
    );
  }
  const levelClass = line.level ? LEVEL_COLOR[line.level] ?? "text-fg-muted" : "text-fg-muted";
  const ts = line.timestamp ? formatTs(line.timestamp) : "";
  return (
    <div className="flex gap-2 whitespace-pre-wrap break-all">
      {ts && <span className="shrink-0 text-fg-muted/60">{ts}</span>}
      {line.level && (
        <span className={`shrink-0 ${levelClass}`}>{line.level.padEnd(5)}</span>
      )}
      {line.target && (
        <span className="shrink-0 text-fg-muted/70">{line.target}</span>
      )}
      <span className="text-fg-term">{line.message}</span>
    </div>
  );
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}
