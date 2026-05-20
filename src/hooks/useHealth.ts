import { create } from "zustand";
import { useEffect } from "react";
import type { HealthStatus } from "@/lib/types";
import { api } from "@/lib/invoke";

interface HealthState {
  health: HealthStatus | null;
  refresh: () => Promise<void>;
}

export const useHealthStore = create<HealthState>((set) => ({
  health: null,
  refresh: async () => {
    try {
      const health = await api.smolvmHealth();
      set({ health });
    } catch (e) {
      set({
        health: { healthy: false, version: null, error: String(e) },
      });
    }
  },
}));

export function useHealthPolling(intervalMs = 5000) {
  const refresh = useHealthStore((s) => s.refresh);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);
}
