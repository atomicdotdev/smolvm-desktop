import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  ArrowDownToLine,
  Eraser,
  Play,
  Square,
  Terminal as TerminalIcon,
} from "lucide-react";
import { useMachinesStore } from "@/hooks/useMachines";

interface TaskChunk {
  stream: "stdout" | "stderr";
  data: string;
}

interface OutputLine {
  stream: "stdout" | "stderr";
  text: string;
}

const MAX_LINES = 10_000;

export function RunTab({ name, running }: { name: string; running: boolean }) {
  const [command, setCommand] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const commandRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!running) return;
    commandRef.current?.focus();
  }, [running]);

  const pausePolling = useMachinesStore((s) => s.pausePolling);
  const resumePolling = useMachinesStore((s) => s.resumePolling);

  useEffect(() => {
    if (!sessionId) return;
    const unlisteners: UnlistenFn[] = [];

    (async () => {
      const dataEv = await listen<TaskChunk>(
        `task-output-${sessionId}`,
        (event) => {
          const chunk = event.payload;
          // Each chunk arrives as a full line including its trailing \n; drop it.
          const text = chunk.data.replace(/\n$/, "");
          setLines((prev) => {
            const next = [...prev, { stream: chunk.stream, text }];
            if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
            return next;
          });
        },
      );
      unlisteners.push(dataEv);

      const exitEv = await listen<number>(
        `task-exit-${sessionId}`,
        (event) => {
          setExitCode(event.payload);
          setSessionId(null);
          resumePolling();
        },
      );
      unlisteners.push(exitEv);
    })();

    return () => {
      unlisteners.forEach((u) => u());
    };
  }, [sessionId, resumePolling]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, autoScroll]);

  const isRunning = sessionId !== null;

  const run = async () => {
    if (!command.trim() || isRunning) return;
    setError(null);
    setExitCode(null);
    setLines([]);
    const id = crypto.randomUUID();
    setSessionId(id);
    pausePolling();
    try {
      await invoke("run_task", { taskId: id, machine: name, command });
    } catch (e) {
      setError(String(e));
      setSessionId(null);
      resumePolling();
    }
  };

  const stop = async () => {
    if (!sessionId) return;
    try {
      await invoke("stop_task", { taskId: sessionId });
    } catch (e) {
      setError(String(e));
    }
  };

  // Stop a running task if the tab unmounts.
  useEffect(
    () => () => {
      if (sessionId) invoke("stop_task", { taskId: sessionId }).catch(() => {});
    },
    [sessionId],
  );

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(nearBottom);
  };

  const exitLabel = useMemo(() => {
    if (isRunning) return null;
    if (exitCode === null) return null;
    const ok = exitCode === 0;
    return {
      text: ok ? `exit 0` : `exit ${exitCode}`,
      className: ok ? "text-running" : "text-stopped",
    };
  }, [exitCode, isRunning]);

  if (!running) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
        Start the machine to run commands against it.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-bg p-4">
        <label className="mb-1 block text-xs uppercase tracking-wide text-fg-muted">
          Command (runs in <span className="font-mono">sh -c</span>)
        </label>
        <div className="flex gap-2">
          <textarea
            ref={commandRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                run();
              }
            }}
            placeholder={`trivy fs --scanners vuln,secret --severity HIGH,CRITICAL --skip-dirs .git --skip-dirs target src`}
            rows={3}
            disabled={isRunning}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoComplete="off"
            className="input flex-1 resize-y font-mono text-sm disabled:opacity-60"
          />
          <div className="flex flex-col gap-2">
            {isRunning ? (
              <button
                onClick={stop}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-stopped/10 hover:text-stopped"
              >
                <Square className="h-4 w-4" />
                Stop
              </button>
            ) : (
              <button
                onClick={run}
                disabled={!command.trim()}
                title="Cmd/Ctrl + Enter"
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40"
              >
                <Play className="h-4 w-4" />
                Run
              </button>
            )}
            <button
              onClick={() => {
                setLines([]);
                setExitCode(null);
                setError(null);
              }}
              disabled={isRunning || lines.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70 disabled:opacity-40"
            >
              <Eraser className="h-4 w-4" />
              Clear
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-stopped/40 bg-stopped/10 px-4 py-2 text-sm text-stopped">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-border bg-bg/60 px-4 py-1.5 text-xs text-fg-muted">
        <TerminalIcon className="h-3.5 w-3.5" />
        <span>
          {isRunning
            ? "Running…"
            : exitLabel
              ? (
                <span className={exitLabel.className}>Finished · {exitLabel.text}</span>
              )
              : "Idle"}
        </span>
        <span className="ml-auto">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
        <label className="flex items-center gap-1">
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
          className="rounded-md p-1 hover:bg-bg-card hover:text-fg"
        >
          <ArrowDownToLine className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-bg-term px-3 py-2 font-mono text-[11px] leading-5 text-fg-term"
      >
        {lines.length === 0 && !isRunning && (
          <div className="p-2 text-fg-muted">Run a command to see its output here.</div>
        )}
        {lines.map((l, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-all ${
              l.stream === "stderr" ? "text-stopped/80" : ""
            }`}
          >
            {l.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
