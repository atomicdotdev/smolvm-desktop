import { create } from "zustand";
import { useEffect } from "react";
import type { Machine, MachineStatus } from "@/lib/types";
import { api } from "@/lib/invoke";
import { useToastsStore, type ToastKind } from "./useToasts";
import { useErrorModal } from "./useErrorModal";

export type MachineAction = "start" | "stop" | "delete";

interface MachinesState {
  machines: Machine[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
  pending: Record<string, MachineAction>;
  /** Names of machines that currently have a desktop-managed supervisor. */
  supervised: string[];
  /** Incremented when a subsystem (e.g. exec PTY) is holding the smolvm DB lock. */
  pauseDepth: number;
  refresh: () => Promise<void>;
  refreshSupervised: () => Promise<void>;
  start: (name: string) => Promise<void>;
  stop: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  pausePolling: () => void;
  resumePolling: () => void;
}

function withPending<T>(
  set: (fn: (s: MachinesState) => Partial<MachinesState>) => void,
  name: string,
  action: MachineAction,
  run: () => Promise<T>,
): Promise<T> {
  set((s) => ({ pending: { ...s.pending, [name]: action } }));
  return run().finally(() => {
    set((s) => {
      const next = { ...s.pending };
      delete next[name];
      return { pending: next };
    });
  });
}

export const useMachinesStore = create<MachinesState>((set, get) => ({
  machines: [],
  loading: false,
  error: null,
  lastFetched: null,
  pending: {},
  supervised: [],
  pauseDepth: 0,
  refreshSupervised: async () => {
    try {
      const names = await api.listSupervised();
      set({ supervised: names });
    } catch {
      // Non-fatal: leave previous list in place.
    }
  },
  pausePolling: () => set((s) => ({ pauseDepth: s.pauseDepth + 1 })),
  resumePolling: () =>
    set((s) => ({ pauseDepth: Math.max(0, s.pauseDepth - 1) })),
  refresh: async () => {
    set({ loading: true });
    try {
      const machines = await api.listMachines();
      machines.sort((a, b) => {
        // Running (has PID) first, ordered by PID; stopped after, by name.
        if (a.pid !== null && b.pid !== null) return a.pid - b.pid;
        if (a.pid !== null) return -1;
        if (b.pid !== null) return 1;
        return a.name.localeCompare(b.name);
      });
      const prev = get().machines;
      notifyTransitions(prev, machines);
      set({ machines, error: null, lastFetched: Date.now() });
      // Best-effort sync of the supervised-name list alongside the machine list.
      void get().refreshSupervised();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },
  start: async (name) => {
    await withPending(set, name, "start", async () => {
      try {
        await api.startMachine(name);
      } catch (e) {
        useErrorModal.getState().show(`Start "${name}" failed`, e);
        throw e;
      } finally {
        await get().refresh();
      }
    });
  },
  stop: async (name) => {
    await withPending(set, name, "stop", async () => {
      try {
        await api.stopMachine(name);
      } catch (e) {
        useErrorModal.getState().show(`Stop "${name}" failed`, e);
        throw e;
      } finally {
        await get().refresh();
      }
    });
  },
  remove: async (name) => {
    await withPending(set, name, "delete", async () => {
      try {
        await api.deleteMachine(name);
      } catch (e) {
        useErrorModal.getState().show(`Delete "${name}" failed`, e);
        throw e;
      } finally {
        await get().refresh();
      }
    });
  },
}));

function notifyTransitions(prev: Machine[], next: Machine[]) {
  if (prev.length === 0) return; // suppress the initial "everything changed"

  const push = useToastsStore.getState().push;
  const prevByName = new Map(prev.map((m) => [m.name, m.status]));
  const nextByName = new Map(next.map((m) => [m.name, m.status]));

  for (const m of next) {
    const before = prevByName.get(m.name);
    if (before === undefined || before === m.status) continue;
    const msg = transitionMessage(m.name, before, m.status);
    if (!msg) continue;
    push(toastKind(m.status), msg);
  }

  for (const m of prev) {
    if (nextByName.has(m.name)) continue;
    push("info", `Machine "${m.name}" removed`);
  }
}

function toastKind(status: MachineStatus): ToastKind {
  if (status === "running") return "success";
  if (status === "unreachable" || status === "exited") return "error";
  return "info";
}

function transitionMessage(
  name: string,
  from: MachineStatus,
  to: MachineStatus,
): string | null {
  // Keep noise low: only surface meaningful transitions.
  if (from === "unknown" || to === "unknown") return null;
  if (to === "running") return `Machine "${name}" is running`;
  if (to === "stopped") return `Machine "${name}" stopped`;
  if (to === "exited") return `Machine "${name}" exited`;
  if (to === "unreachable") return `Machine "${name}" became unreachable`;
  return null;
}

export function useMachinesPolling(intervalMs = 3000) {
  useEffect(() => {
    const tick = () => {
      const { pauseDepth, refresh } = useMachinesStore.getState();
      if (pauseDepth === 0) refresh();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
