import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToastsStore, type ToastKind } from "@/hooks/useToasts";

const STYLES: Record<ToastKind, { bar: string; icon: React.ReactNode }> = {
  info: { bar: "border-accent", icon: <Info className="h-4 w-4 text-accent" /> },
  success: {
    bar: "border-running",
    icon: <CheckCircle2 className="h-4 w-4 text-running" />,
  },
  error: {
    bar: "border-stopped",
    icon: <AlertCircle className="h-4 w-4 text-stopped" />,
  },
};

export function Toaster() {
  const toasts = useToastsStore((s) => s.toasts);
  const dismiss = useToastsStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const s = STYLES[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-md border-l-2 bg-bg-card p-3 shadow-lg ${s.bar}`}
          >
            <div className="mt-0.5 shrink-0">{s.icon}</div>
            <div className="flex-1 text-sm">{t.message}</div>
            <button
              onClick={() => dismiss(t.id)}
              className="rounded p-0.5 text-fg-muted hover:bg-bg hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
