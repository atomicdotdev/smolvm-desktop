import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="font-mono text-xs">
      <Node value={data} depth={0} />
    </div>
  );
}

function Node({
  name,
  value,
  depth,
}: {
  name?: string;
  value: unknown;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);

  if (value === null) return <Leaf name={name} text="null" className="text-fg-muted" />;
  if (typeof value === "boolean")
    return <Leaf name={name} text={String(value)} className="text-accent" />;
  if (typeof value === "number")
    return <Leaf name={name} text={String(value)} className="text-starting" />;
  if (typeof value === "string")
    return <Leaf name={name} text={JSON.stringify(value)} className="text-running" />;

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) {
    return <Leaf name={name} text={isArray ? "[]" : "{}"} className="text-fg-muted" />;
  }

  return (
    <div className="leading-5">
      <button
        className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {name !== undefined && <span className="text-fg">{name}:</span>}
        <span className="text-fg-muted">
          {isArray ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </button>
      {open && (
        <div className="border-l border-border/60 pl-4 ml-1.5 mt-0.5">
          {entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function Leaf({
  name,
  text,
  className,
}: {
  name?: string;
  text: string;
  className?: string;
}) {
  return (
    <div className="leading-5">
      {name !== undefined && <span className="text-fg">{name}: </span>}
      <span className={className}>{text}</span>
    </div>
  );
}
