import { useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ArrowDownToLine, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { api } from "@/lib/invoke";
import type { Machine, MonitorOverrides } from "@/lib/types";

const MAX_LOG_LINES = 200;

interface Props {
  machine: Machine;
}

/** Human-readable summary of the persisted restart policy. */
function formatRestartPolicy(m: Machine): string {
  const policy = m.restart_policy ?? "never";
  if (policy === "never") return "never";
  const parts = [policy];
  // max_retries: 0 means unlimited in smolvm.
  if (m.restart_max_retries != null) {
    parts.push(
      m.restart_max_retries === 0
        ? "unlimited retries"
        : `max ${m.restart_max_retries} retries`,
    );
  }
  if (m.restart_count != null && m.restart_count > 0) {
    parts.push(`${m.restart_count} so far`);
  }
  return parts.join(" · ");
}

/** Human-readable summary of the persisted health check. */
function formatHealthPolicy(m: Machine): string {
  if (!m.health_cmd) return "none configured";
  const parts = [m.health_cmd];
  if (m.health_interval_secs != null) parts.push(`every ${m.health_interval_secs}s`);
  if (m.health_timeout_secs != null) parts.push(`timeout ${m.health_timeout_secs}s`);
  if (m.health_retries != null) parts.push(`${m.health_retries} retries`);
  if (m.health_startup_grace_secs != null)
    parts.push(`${m.health_startup_grace_secs}s grace`);
  return parts.join(" · ");
}

/**
 * Live status derived from scraping `smolvm machine monitor`'s stdout.
 * Prose parsing is fragile but covers the documented v0.7.2 output shape.
 * If/when upstream adds `--output json`, swap this for structured events.
 */
interface DerivedStatus {
  phase: "starting" | "running" | "restarting" | "stopped" | "failed";
  policy?: string;
  intervalSecs?: number;
  healthRetries?: number;
  healthTimeoutSecs?: number;
  restartCount: number;
  lastRestartAttempt?: { attempt: number; backoffSecs: number };
  lastHealth?: "ok" | "failed";
  terminalReason?: string;
}

function deriveStatus(lines: string[], exitCode: number | null): DerivedStatus {
  const status: DerivedStatus = {
    phase: lines.length === 0 ? "starting" : "running",
    restartCount: 0,
  };

  for (const raw of lines) {
    const line = raw.trim();

    // "Monitoring machine 'X' (policy: on-failure, interval: 10s)"
    const start = line.match(
      /^Monitoring machine '[^']+' \(policy: ([^,]+), interval: (\d+)s\)/,
    );
    if (start) {
      status.policy = start[1];
      status.intervalSecs = Number(start[2]);
      continue;
    }

    // "Health check: retries=N, timeout=Ns"
    const health = line.match(/^Health check: retries=(\d+), timeout=(\d+)s/);
    if (health) {
      status.healthRetries = Number(health[1]);
      status.healthTimeoutSecs = Number(health[2]);
      continue;
    }

    // "restarting (attempt N, backoff Ns)"
    const restarting = line.match(/^restarting \(attempt (\d+), backoff (\d+)s\)/);
    if (restarting) {
      status.phase = "restarting";
      status.lastRestartAttempt = {
        attempt: Number(restarting[1]),
        backoffSecs: Number(restarting[2]),
      };
      status.restartCount = Math.max(status.restartCount, Number(restarting[1]));
      continue;
    }

    // "machine restarted"
    if (/^machine restarted/.test(line)) {
      status.phase = "running";
      continue;
    }

    // "not restarting (policy: ..., count: ...)"
    const notRestarting = line.match(/^not restarting \((.+)\)/);
    if (notRestarting) {
      status.phase = "stopped";
      status.terminalReason = notRestarting[1];
      continue;
    }

    // "Stopped monitoring. Machine 'X' may still be running."
    if (/^Stopped monitoring/.test(line)) {
      status.phase = "stopped";
      continue;
    }

    // Heuristic health-check signal (varies in upstream output; we accept
    // common shapes without committing to one exact line).
    if (/health check (passed|ok)/i.test(line)) status.lastHealth = "ok";
    else if (/health check (failed|timed out)/i.test(line))
      status.lastHealth = "failed";

    // Common VM-startup failure mode.
    if (/krun_start_enter returned/.test(line) || /failed to start/i.test(line)) {
      status.phase = "failed";
    }
  }

  if (exitCode !== null) {
    if (status.phase === "running" || status.phase === "starting") {
      status.phase = exitCode === 0 ? "stopped" : "failed";
    }
  }

  return status;
}

function formatUptime(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function MonitorTab({ machine }: Props) {
  const [supervising, setSupervising] = useState(false);
  const [pending, setPending] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [activeOverrides, setActiveOverrides] = useState<MonitorOverrides | null>(
    null,
  );
  const [draft, setDraft] = useState<MonitorOverrides>({});
  const [showDrawer, setShowDrawer] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [now, setNow] = useState(Date.now());

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Tick once a second to refresh uptime display.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Subscribe to log + exit events and backfill from the supervisor snapshot
  // whenever the tab is shown or the machine changes.
  useEffect(() => {
    let unlistenLog: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      try {
        const snap = await api.superviseStatus(machine.name);
        if (cancelled) return;
        if (snap) {
          setSupervising(true);
          setLogs(snap.log_tail);
          setStartedAtMs(snap.started_at_ms);
          setExitCode(snap.exit_code);
          setActiveOverrides(snap.overrides);
          setDraft(snap.overrides);
        } else {
          setSupervising(false);
          setLogs([]);
          setStartedAtMs(null);
          setExitCode(null);
          setActiveOverrides(null);
        }

        unlistenLog = await listen<string>(
          `supervisor-log-${machine.name}`,
          (event) => {
            setLogs((prev) => {
              const next = [...prev, event.payload];
              if (next.length > MAX_LOG_LINES)
                next.splice(0, next.length - MAX_LOG_LINES);
              return next;
            });
          },
        );

        unlistenExit = await listen<number>(
          `supervisor-exit-${machine.name}`,
          (event) => {
            setExitCode(event.payload);
          },
        );
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenLog) unlistenLog();
      if (unlistenExit) unlistenExit();
    };
  }, [machine.name]);

  // Auto-scroll the log panel.
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [logs, autoScroll]);

  const onLogScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(nearBottom);
  };

  const derived = useMemo(() => deriveStatus(logs, exitCode), [logs, exitCode]);

  const overridesChanged = useMemo(
    () => overridesDiffer(activeOverrides ?? {}, draft),
    [activeOverrides, draft],
  );

  const handleToggle = async () => {
    setError(null);
    if (supervising) {
      setPending("stop");
      try {
        await api.superviseStop(machine.name);
        setSupervising(false);
        setStartedAtMs(null);
        setExitCode(null);
        setActiveOverrides(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setPending(null);
      }
    } else {
      setPending("start");
      try {
        const overrides = normalizeOverrides(draft);
        await api.superviseStart(machine.name, overrides);
        setSupervising(true);
        setLogs([]);
        setStartedAtMs(Date.now());
        setExitCode(null);
        setActiveOverrides(overrides);
      } catch (e) {
        setError(String(e));
      } finally {
        setPending(null);
      }
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Persisted policy panel */}
      <section className="border-b border-border bg-bg px-6 py-4">
        <h3 className="text-sm font-medium text-fg">Persisted policy</h3>
        {machine.restart_policy === null ? (
          <p className="mt-1 text-xs text-fg-muted">
            Policy read-back requires smolvm ≥ 0.8.0. Upgrade to see the
            restart and health policy set at create time.
          </p>
        ) : (
          <dl className="mt-2 space-y-1.5 text-xs">
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-fg-muted">Restart</dt>
              <dd className="text-fg">{formatRestartPolicy(machine)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-fg-muted">Health check</dt>
              <dd className="text-fg">{formatHealthPolicy(machine)}</dd>
            </div>
          </dl>
        )}
      </section>

      {/* Supervisor panel */}
      <section className="border-b border-border bg-bg px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-fg">Supervise this machine</h3>
            <p className="mt-1 text-xs text-fg-muted">
              Runs <code>smolvm machine monitor</code> in the background to
              enforce restart and health policy.
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={pending !== null}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              supervising
                ? "border border-border bg-bg-card text-fg hover:bg-bg-card/70"
                : "bg-accent text-white hover:bg-accent/90"
            } disabled:opacity-60`}
          >
            {pending !== null && <Loader2 className="h-4 w-4 animate-spin" />}
            {supervising
              ? pending === "stop"
                ? "Stopping…"
                : "Stop supervising"
              : pending === "start"
                ? "Starting…"
                : "Supervise this machine"}
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded border border-stopped/40 bg-stopped/10 p-2 text-xs text-stopped">
            {error}
          </div>
        )}

        {supervising && (
          <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
            <StatusRow label="Phase" value={phaseLabel(derived.phase)} />
            <StatusRow
              label="Uptime"
              value={
                startedAtMs !== null
                  ? formatUptime(now - startedAtMs)
                  : "—"
              }
            />
            <StatusRow label="Policy" value={derived.policy ?? "—"} />
            <StatusRow
              label="Restart count"
              value={String(derived.restartCount)}
            />
            <StatusRow
              label="Interval"
              value={
                derived.intervalSecs !== undefined
                  ? `${derived.intervalSecs}s`
                  : "—"
              }
            />
            <StatusRow
              label="Last health"
              value={
                derived.lastHealth === "ok"
                  ? "ok"
                  : derived.lastHealth === "failed"
                    ? "failed"
                    : "—"
              }
            />
            {derived.lastRestartAttempt && (
              <StatusRow
                label="Last restart"
                value={`attempt ${derived.lastRestartAttempt.attempt} (backoff ${derived.lastRestartAttempt.backoffSecs}s)`}
              />
            )}
            {derived.terminalReason && (
              <StatusRow label="Terminal" value={derived.terminalReason} />
            )}
            {exitCode !== null && (
              <StatusRow label="Exit code" value={String(exitCode)} />
            )}
          </div>
        )}
      </section>

      {/* Override drawer */}
      <section className="border-b border-border bg-bg px-6 py-3">
        <button
          onClick={() => setShowDrawer((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
        >
          {showDrawer ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Session overrides
        </button>
        {showDrawer && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <OverrideSelect
              label="Restart policy"
              value={draft.restart ?? ""}
              onChange={(v) =>
                setDraft({ ...draft, restart: v ? v : null })
              }
              options={["", "never", "always", "on-failure", "unless-stopped"]}
            />
            <OverrideText
              label="Health command"
              value={draft.health_cmd ?? ""}
              placeholder="e.g. curl -f http://127.0.0.1:8080/health"
              onChange={(v) =>
                setDraft({ ...draft, health_cmd: v.length > 0 ? v : null })
              }
            />
            <OverrideNumber
              label="Interval (s)"
              value={draft.interval_secs ?? null}
              onChange={(v) => setDraft({ ...draft, interval_secs: v })}
            />
            <OverrideNumber
              label="Health timeout (s)"
              value={draft.health_timeout_secs ?? null}
              onChange={(v) =>
                setDraft({ ...draft, health_timeout_secs: v })
              }
            />
            <OverrideNumber
              label="Health retries"
              value={draft.health_retries ?? null}
              onChange={(v) => setDraft({ ...draft, health_retries: v })}
            />
            {supervising && overridesChanged && (
              <p className="col-span-2 text-xs text-starting">
                Restart supervisor to apply the new overrides.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Live log tail */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-2">
          <div className="flex-1 text-xs text-fg-muted">
            {logs.length} / {MAX_LOG_LINES} lines · supervisor stdout
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
            onClick={() =>
              bottomRef.current?.scrollIntoView({ block: "end" })
            }
            title="Scroll to bottom"
            className="rounded-md p-1 text-fg-muted hover:bg-bg-card hover:text-fg"
          >
            <ArrowDownToLine className="h-4 w-4" />
          </button>
        </div>
        <div
          ref={scrollRef}
          onScroll={onLogScroll}
          className="flex-1 overflow-auto bg-bg-term px-3 py-2 font-mono text-[11px] leading-5 text-fg-term"
        >
          {!supervising && logs.length === 0 && (
            <div className="px-2 py-4 text-fg-muted">
              Not supervising. Toggle on to spawn{" "}
              <code>smolvm machine monitor</code>.
            </div>
          )}
          {logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </section>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-fg-muted">{label}</span>
      <span className="font-mono text-fg">{value}</span>
    </div>
  );
}

function OverrideSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "" ? "(use persisted)" : o}
          </option>
        ))}
      </select>
    </label>
  );
}

function OverrideText({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {label}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm text-fg focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function OverrideNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {label}
      <input
        type="number"
        min={0}
        value={value === null ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") onChange(null);
          else {
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }
        }}
        className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm text-fg focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function phaseLabel(phase: DerivedStatus["phase"]): string {
  switch (phase) {
    case "starting":
      return "starting";
    case "running":
      return "running";
    case "restarting":
      return "restarting";
    case "stopped":
      return "stopped";
    case "failed":
      return "failed-to-start";
  }
}

function normalizeOverrides(d: MonitorOverrides): MonitorOverrides {
  const out: MonitorOverrides = {};
  if (d.restart && d.restart.trim().length > 0) out.restart = d.restart.trim();
  if (d.health_cmd && d.health_cmd.trim().length > 0)
    out.health_cmd = d.health_cmd.trim();
  if (typeof d.health_timeout_secs === "number")
    out.health_timeout_secs = d.health_timeout_secs;
  if (typeof d.interval_secs === "number") out.interval_secs = d.interval_secs;
  if (typeof d.health_retries === "number")
    out.health_retries = d.health_retries;
  return out;
}

function overridesDiffer(a: MonitorOverrides, b: MonitorOverrides): boolean {
  const na = normalizeOverrides(a);
  const nb = normalizeOverrides(b);
  return JSON.stringify(na) !== JSON.stringify(nb);
}
