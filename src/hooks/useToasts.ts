import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastsState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: string) => void;
}

export const useToastsStore = create<ToastsState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
