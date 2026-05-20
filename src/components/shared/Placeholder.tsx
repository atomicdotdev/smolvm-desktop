export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-muted">
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      <p className="text-sm">Coming in {phase}.</p>
    </div>
  );
}
