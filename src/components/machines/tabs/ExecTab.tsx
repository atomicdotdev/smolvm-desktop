import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useMachinesStore } from "@/hooks/useMachines";

const THEME = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#c9d1d9",
  selectionBackground: "#2a3050",
  black: "#0d1117",
  red: "#f87171",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#4c7bf4",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#c9d1d9",
  brightBlack: "#8b92a8",
  brightRed: "#fca5a5",
  brightGreen: "#6ee7b7",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
};

export function ExecTab({ name, running }: { name: string; running: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    if (!running || !containerRef.current) return;

    // Exec holds the smolvm DB lock — concurrent `machine ls` calls fail and
    // mark every VM "unreachable". Suspend list polling for the session's life.
    const { pausePolling, resumePolling } = useMachinesStore.getState();
    pausePolling();

    const sessionId = crypto.randomUUID();
    const term = new Terminal({
      theme: THEME,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.focus();

    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    (async () => {
      try {
        const dataEv = await listen<string>(`exec-data-${sessionId}`, (e) => {
          setConnecting(false);
          term.write(e.payload);
        });
        unlisteners.push(dataEv);

        const exitEv = await listen<number>(`exec-exit-${sessionId}`, (e) => {
          setExitCode(e.payload);
          term.write(`\r\n\x1b[90m[session ended, exit ${e.payload}]\x1b[0m\r\n`);
        });
        unlisteners.push(exitEv);

        await invoke("exec_start", {
          sessionId,
          machine: name,
          // Omit `command` so the backend picks its default chain that prefers
          // bash interactive (for bracketed paste / multi-line paste support).
          cols: term.cols,
          rows: term.rows,
        });

        // In React StrictMode (dev), the effect mounts → cleans up → mounts again,
        // and cleanup can fire before exec_start resolves. If we were disposed in
        // the meantime, the cleanup's exec_stop no-op'd — tear down now so the
        // backend's CLI lock isn't orphaned.
        if (disposed) {
          invoke("exec_stop", { sessionId }).catch(() => {});
          return;
        }

        term.onData((data) => {
          if (disposed) return;
          invoke("exec_write", { sessionId, data }).catch(() => {});
        });
        term.onResize(({ cols, rows }) => {
          invoke("exec_resize", { sessionId, cols, rows }).catch(() => {});
        });
      } catch (e) {
        setError(String(e));
        setConnecting(false);
      }
    })();

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {}
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      unlisteners.forEach((u) => u());
      invoke("exec_stop", { sessionId }).catch(() => {});
      term.dispose();
      resumePolling();
    };
  }, [name, running]);

  if (!running) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
        Start the machine to open a shell.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-term">
      {error && (
        <div className="border-b border-stopped/40 bg-stopped/10 px-4 py-2 text-sm text-stopped">
          {error}
        </div>
      )}
      {connecting && !error && (
        <div className="border-b border-border bg-bg px-4 py-1.5 text-xs text-fg-muted">
          Connecting to {name}…
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-hidden p-2" />
      {exitCode !== null && (
        <div className="border-t border-border bg-bg px-4 py-1.5 text-xs text-fg-muted">
          Session ended (exit {exitCode}). Switch tabs and back to reopen.
        </div>
      )}
    </div>
  );
}
