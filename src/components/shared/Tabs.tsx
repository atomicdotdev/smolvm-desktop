import type { ReactNode } from "react";

export interface Tab {
  id: string;
  label: string;
}

interface Props {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  children: ReactNode;
}

export function Tabs({ tabs, active, onChange, children }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-border bg-bg">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`border-b-2 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-muted hover:text-fg"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
