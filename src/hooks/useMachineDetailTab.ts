import { create } from "zustand";

interface State {
  pending: { name: string; tab: string } | null;
  set: (name: string, tab: string) => void;
  clear: () => void;
}

export const useMachineDetailTab = create<State>((set) => ({
  pending: null,
  set: (name, tab) => set({ pending: { name, tab } }),
  clear: () => set({ pending: null }),
}));
