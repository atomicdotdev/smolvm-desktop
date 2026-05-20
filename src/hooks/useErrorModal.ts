import { create } from "zustand";

interface ErrorModalState {
  title: string | null;
  detail: string | null;
  show: (title: string, detail: unknown) => void;
  close: () => void;
}

/** Strip ANSI color escape sequences so error text renders cleanly. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export const useErrorModal = create<ErrorModalState>((set) => ({
  title: null,
  detail: null,
  show: (title, detail) =>
    set({ title, detail: stripAnsi(String(detail)) }),
  close: () => set({ title: null, detail: null }),
}));
