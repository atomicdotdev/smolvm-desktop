import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Sidebar } from "@/components/layout/Sidebar";
import { useMachineDetailTab } from "@/hooks/useMachineDetailTab";
import { StatusBar } from "@/components/layout/StatusBar";
import { MachineList } from "@/components/machines/MachineList";
import { MachineDetail } from "@/components/machines/MachineDetail";
import { NewMachineDialog } from "@/components/machines/NewMachineDialog";
import { useNewMachineDialog } from "@/hooks/useNewMachineDialog";
import { useShortcuts } from "@/hooks/useShortcuts";
import { ImagesView } from "@/components/images/ImagesView";
import { VolumesView } from "@/components/volumes/VolumesView";
import { PacksView } from "@/components/packs/PacksView";
import { SystemDashboard } from "@/components/stats/SystemDashboard";
import { SettingsView, getPollInterval, loadBinaryOverride } from "@/components/settings/SettingsView";
import { api } from "@/lib/invoke";
import { Toaster } from "@/components/shared/Toaster";
import { ErrorModal } from "@/components/shared/ErrorModal";
import { useHealthPolling } from "@/hooks/useHealth";
import { useMachinesPolling, useMachinesStore } from "@/hooks/useMachines";
import { Keyboard } from "lucide-react";
import type { View } from "@/lib/types";

export default function App() {
  const [view, setView] = useState<View>("machines");
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [machineFilterImage, setMachineFilterImage] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // Apply any persisted binary-path override before we start polling.
  useEffect(() => {
    const override = loadBinaryOverride();
    if (!override) return;
    api
      .setSmolvmBinary(
        override.path,
        override.env,
        override.cwd,
        override.prefixArgs,
        override.argJoin,
      )
      .catch(() => {});
  }, []);
  useHealthPolling();
  useMachinesPolling(getPollInterval());

  const dialog = useNewMachineDialog();
  const refreshMachines = useMachinesStore((s) => s.refresh);

  const handleNav = (v: View) => {
    setView(v);
    setSelectedMachine(null);
    if (v !== "machines") setMachineFilterImage(null);
  };

  useShortcuts(
    {
      "mod+1": () => handleNav("machines"),
      "mod+2": () => handleNav("images"),
      "mod+3": () => handleNav("volumes"),
      "mod+4": () => handleNav("packs"),
      "mod+5": () => handleNav("stats"),
      "mod+,": () => handleNav("settings"),
      "mod+n": (e) => {
        e.preventDefault();
        dialog.openDialog();
      },
      "mod+r": (e) => {
        e.preventDefault();
        refreshMachines();
      },
      escape: () => {
        if (selectedMachine) setSelectedMachine(null);
      },
      "shift+?": () => setHelpOpen((v) => !v),
    },
    [selectedMachine],
  );

  const gotoMachineByName = (name: string) => {
    setMachineFilterImage(null);
    setSelectedMachine(name);
    setView("machines");
  };

  useEffect(() => {
    const unlistens: Promise<UnlistenFn>[] = [
      listen<View>("tray:navigate", (e) => handleNav(e.payload)),
      listen<{ name: string; tab?: string }>("tray:focus-machine", (e) => {
        const { name, tab } = e.payload;
        if (tab) useMachineDetailTab.getState().set(name, tab);
        setMachineFilterImage(null);
        setSelectedMachine(name);
        setView("machines");
      }),
      listen("tray:new-machine", () => dialog.openDialog()),
    ];
    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()));
    };
  }, [dialog]);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar view={view} onChange={handleNav} />
        <main className="flex-1 overflow-hidden bg-bg">
          {view === "machines" && (
            <MachinesView
              selected={selectedMachine}
              onSelect={setSelectedMachine}
              onBack={() => setSelectedMachine(null)}
              filterImage={machineFilterImage}
              onClearFilter={() => setMachineFilterImage(null)}
            />
          )}
          {view === "images" && <ImagesView onViewMachines={gotoMachineByName} />}
          {view === "volumes" && (
            <VolumesView
              onViewMachines={(name) => {
                setSelectedMachine(name);
                setView("machines");
              }}
            />
          )}
          {view === "packs" && (
            <PacksView onOpenSettings={() => handleNav("settings")} />
          )}
          {view === "stats" && <SystemDashboard />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>
      <StatusBar onOpenSettings={() => handleNav("settings")} />
      <Toaster />
      <ErrorModal />
      <NewMachineDialog
        open={dialog.open}
        initialImage={dialog.initialImage}
        onClose={dialog.close}
      />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <button
        onClick={() => setHelpOpen(true)}
        title="Keyboard shortcuts (?)"
        className="fixed bottom-11 left-3 rounded-md p-1 text-fg-muted hover:bg-bg-card hover:text-fg"
      >
        <Keyboard className="h-4 w-4" />
      </button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘/Ctrl + 1", "Machines"],
  ["⌘/Ctrl + 2", "Images"],
  ["⌘/Ctrl + 3", "Volumes"],
  ["⌘/Ctrl + 4", "Packs"],
  ["⌘/Ctrl + 5", "Stats"],
  ["⌘/Ctrl + ,", "Settings"],
  ["⌘/Ctrl + N", "New machine"],
  ["⌘/Ctrl + R", "Refresh machines"],
  ["Esc", "Back to list"],
  ["Shift + ?", "Show this panel"],
];

function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-96 rounded-lg border border-border bg-bg-card p-4 shadow-2xl"
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Keyboard shortcuts
        </h2>
        <ul className="divide-y divide-border/60">
          {SHORTCUTS.map(([keys, label]) => (
            <li key={keys} className="flex justify-between py-1.5 text-sm">
              <span>{label}</span>
              <kbd className="rounded bg-bg px-1.5 py-0.5 font-mono text-xs text-fg-muted">
                {keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MachinesView({
  selected,
  onSelect,
  onBack,
  filterImage,
  onClearFilter,
}: {
  selected: string | null;
  onSelect: (name: string) => void;
  onBack: () => void;
  filterImage: string | null;
  onClearFilter: () => void;
}) {
  const machine = useMachinesStore((s) =>
    selected ? s.machines.find((m) => m.name === selected) ?? null : null,
  );

  if (machine) return <MachineDetail machine={machine} onBack={onBack} />;

  // `selected` set but machine gone (just deleted) — fall through to the list.
  return (
    <MachineList
      onSelect={onSelect}
      filterImage={filterImage}
      onClearFilter={onClearFilter}
    />
  );
}
