import { BarChart3, HardDrive, Layers, Server, Settings, Zap } from "lucide-react";
import type { View } from "@/lib/types";

interface NavItem {
  id: View;
  label: string;
  icon: typeof Server;
}

const NAV: NavItem[] = [
  { id: "machines", label: "Machines", icon: Server },
  { id: "images", label: "Images", icon: Layers },
  { id: "volumes", label: "Volumes", icon: HardDrive },
  { id: "stats", label: "Stats", icon: BarChart3 },
];

interface Props {
  view: View;
  onChange: (view: View) => void;
}

export function Sidebar({ view, onChange }: Props) {
  return (
    <aside className="flex w-56 flex-col border-r border-border bg-bg-sidebar">
      <div className="flex items-center gap-2 px-5 py-5 text-lg font-semibold">
        <Zap className="h-5 w-5 text-accent" />
        <span>SmolVM</span>
      </div>
      <nav className="flex-1 px-3 py-2">
        {NAV.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={view === item.id}
            onClick={() => onChange(item.id)}
          />
        ))}
        <div className="my-3 border-t border-border" />
        <NavButton
          item={{ id: "settings", label: "Settings", icon: Settings }}
          active={view === "settings"}
          onClick={() => onChange("settings")}
        />
      </nav>
    </aside>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-accent/20 text-fg"
          : "text-fg-muted hover:bg-bg-card hover:text-fg"
      }`}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </button>
  );
}
