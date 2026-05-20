import { useEffect, useState } from "react";
import { AlertCircle, Check, Copy, X } from "lucide-react";
import { useErrorModal } from "@/hooks/useErrorModal";

export function ErrorModal() {
  const { title, detail, close } = useErrorModal();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!title) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [title, close]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (!title) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail ?? "");
      setCopied(true);
    } catch {
      // best-effort
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={close}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-stopped/50 bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border bg-stopped/10 px-5 py-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-stopped" />
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          <button
            onClick={close}
            className="rounded-md p-1 text-fg-muted hover:bg-bg hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-auto">
          <pre className="whitespace-pre-wrap break-all p-5 font-mono text-xs leading-5 text-fg-term">
            {detail ?? ""}
          </pre>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border bg-bg px-5 py-3">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70"
          >
            {copied ? (
              <Check className="h-4 w-4 text-running" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={close}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
