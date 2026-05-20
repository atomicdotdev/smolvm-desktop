import { create } from "zustand";

interface State {
  open: boolean;
  initialImage: string | null;
  openDialog: (initialImage?: string) => void;
  close: () => void;
}

export const useNewMachineDialog = create<State>((set) => ({
  open: false,
  initialImage: null,
  openDialog: (initialImage) =>
    set({ open: true, initialImage: initialImage ?? null }),
  close: () => set({ open: false, initialImage: null }),
}));
