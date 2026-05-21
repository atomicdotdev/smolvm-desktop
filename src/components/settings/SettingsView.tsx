import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Eraser,
  ExternalLink,
  FolderOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "@/lib/invoke";
import { useHealthStore } from "@/hooks/useHealth";
import type { SmolvmBinary, SystemInfo } from "@/lib/types";

const PREFS_KEY = "smolvm-desktop.prefs";
const BINARY_KEY = "smolvm-desktop.binary";
const DEFAULT_BINARY_LABEL = "smolvm (from PATH)";

interface Prefs {
  pollIntervalSec: number;
  confirmDestructive: boolean;
}
const DEFAULT_PREFS: Prefs = {
  pollIntervalSec: 3,
  confirmDestructive: true,
};

type EnvPairs = [string, string][];

interface BinaryOverride {
  path: string | null;
  env: EnvPairs;
  cwd: string | null;
  prefixArgs: string[];
  argJoin: string | null;
}

const CARGO_MAKE_PRESET: Partial<BinaryOverride> = {
  path: "cargo",
  prefixArgs: ["make", "smolvm"],
  argJoin: ";",
};

interface PendingChange {
  mode: "edit" | "reset";
  override: BinaryOverride;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function loadBinaryOverride(): BinaryOverride | null {
  const raw = localStorage.getItem(BINARY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BinaryOverride>;
    return {
      path: parsed.path ?? null,
      env: Array.isArray(parsed.env) ? parsed.env : [],
      cwd: parsed.cwd ?? null,
      prefixArgs: Array.isArray(parsed.prefixArgs) ? parsed.prefixArgs : [],
      argJoin: parsed.argJoin ?? null,
    };
  } catch {
    return null;
  }
}

function saveBinaryOverride(override: BinaryOverride | null) {
  if (override === null) {
    localStorage.removeItem(BINARY_KEY);
    return;
  }
  localStorage.setItem(BINARY_KEY, JSON.stringify(override));
}

export type SettingsSection = "registries";

interface SettingsViewProps {
  focusSection?: SettingsSection | null;
  onFocusSectionConsumed?: () => void;
}

export function SettingsView({
  focusSection = null,
  onFocusSectionConsumed,
}: SettingsViewProps = {}) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [current, setCurrent] = useState<SmolvmBinary>({
    path: "smolvm",
    env: [],
    cwd: null,
    prefix_args: [],
    arg_join: null,
  });
  const [config, setConfig] = useState("");
  const [configErr, setConfigErr] = useState<string | null>(null);
  const [registries, setRegistries] = useState("");
  const [registriesOriginal, setRegistriesOriginal] = useState("");
  const [registriesPath, setRegistriesPath] = useState<string | null>(null);
  const [registriesErr, setRegistriesErr] = useState<string | null>(null);
  const [registriesStatus, setRegistriesStatus] = useState<string | null>(null);
  const [savingRegistries, setSavingRegistries] = useState(false);
  const registriesSectionRef = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs());
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const refreshHealth = useHealthStore((s) => s.refresh);

  const refresh = async () => {
    setLoading(true);
    try {
      let configError: string | null = null;
      let registriesError: string | null = null;
      const [i, c, bin, reg, regPath] = await Promise.all([
        api.systemInfo(),
        api.smolvmConfig().catch((e) => {
          configError = String(e);
          return "";
        }),
        api.getSmolvmBinary(),
        api.readRegistries().catch((e) => {
          registriesError = String(e);
          return "";
        }),
        api.getRegistriesPath().catch(() => ""),
      ]);
      setInfo(i);
      setConfig(c);
      setCurrent(bin);
      setConfigErr(configError);
      setRegistries(reg);
      setRegistriesOriginal(reg);
      setRegistriesPath(regPath ? regPath.trim() : null);
      setRegistriesErr(registriesError);
      setRegistriesStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const saveRegistries = async () => {
    if (savingRegistries) return;
    setSavingRegistries(true);
    setRegistriesErr(null);
    setRegistriesStatus(null);
    try {
      await api.writeRegistries(registries);
      setRegistriesOriginal(registries);
      setRegistriesStatus("Saved.");
    } catch (e) {
      setRegistriesErr(String(e));
    } finally {
      setSavingRegistries(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (focusSection !== "registries") return;
    // Defer to next frame so the section is mounted before we scroll.
    const id = requestAnimationFrame(() => {
      registriesSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      onFocusSectionConsumed?.();
    });
    return () => cancelAnimationFrame(id);
  }, [focusSection, onFocusSectionConsumed]);

  const updatePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  };

  const openChangeDialog = () => {
    setPendingError(null);
    setPending({
      mode: "edit",
      override: {
        path: current.path === "smolvm" ? null : current.path,
        env: current.env.map(([k, v]) => [k, v]),
        cwd: current.cwd,
        prefixArgs: [...current.prefix_args],
        argJoin: current.arg_join,
      },
    });
  };

  const requestReset = () => {
    setPendingError(null);
    setPending({
      mode: "reset",
      override: {
        path: null,
        env: [],
        cwd: null,
        prefixArgs: [],
        argJoin: null,
      },
    });
  };

  const applyChange = async () => {
    if (!pending || applying) return;
    const { override } = pending;
    setPendingError(null);
    setApplying(true);
    try {
      const health = await api.setSmolvmBinary(
        override.path,
        override.env,
        override.cwd,
        override.prefixArgs,
        override.argJoin,
      );
      if (!health.healthy) {
        throw new Error(
          health.error
            ? `Couldn't run the new binary: ${health.error}`
            : "Binary not reachable — refusing to apply",
        );
      }
      const hasOverride =
        (override.path ?? "").trim().length > 0 ||
        override.env.length > 0 ||
        (override.cwd ?? "").trim().length > 0 ||
        override.prefixArgs.length > 0 ||
        (override.argJoin ?? "").length > 0;
      saveBinaryOverride(hasOverride ? override : null);
      setPending(null);
      await Promise.all([refresh(), refreshHealth()]);
    } catch (e) {
      console.error("apply binary change failed", e);
      setPendingError(String(e));
    } finally {
      setApplying(false);
    }
  };

  const hasOverride =
    current.path !== "smolvm" ||
    current.env.length > 0 ||
    current.cwd !== null ||
    current.prefix_args.length > 0 ||
    current.arg_join !== null;

  const resetAll = async () => {
    try {
      await api.setSmolvmBinary(null, [], null, [], null);
    } catch {
      // best-effort
    }
    localStorage.removeItem(BINARY_KEY);
    localStorage.removeItem(PREFS_KEY);
    setPrefs(DEFAULT_PREFS);
    setConfirmReset(false);
    await Promise.all([refresh(), refreshHealth()]);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-bg px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-fg-muted">smolvm environment and app preferences</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70 disabled:opacity-70"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-auto p-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            smolvm
          </h2>
          <div className="space-y-4 rounded-md border border-border bg-bg-card p-4 text-sm">
            <Row label="Version" value={info?.smolvm_version ?? "—"} />
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wide text-fg-muted">
                Binary
              </div>
              <code className="block truncate rounded bg-bg px-2 py-1.5 font-mono text-xs">
                {info?.smolvm_path ?? "not found"}
              </code>
              <div className="flex items-center gap-2">
                <button
                  onClick={openChangeDialog}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1.5 text-xs hover:bg-bg-card/70"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Change binary / env…
                </button>
                {hasOverride && (
                  <button
                    onClick={requestReset}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1.5 text-xs hover:bg-bg-card/70"
                    title="Reset to PATH lookup with no env overrides"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </button>
                )}
              </div>
              <div className="text-xs text-fg-muted">
                Currently using{" "}
                <span className="font-mono text-fg">
                  {formatInvocation(current)}
                </span>
                {current.env.length > 0 &&
                  ` · ${current.env.length} env var${current.env.length === 1 ? "" : "s"}`}
                {current.cwd && " · custom working dir"}.
              </div>
              {current.cwd && (
                <div className="font-mono text-[11px] text-fg-muted break-all">
                  cwd: {current.cwd}
                </div>
              )}
              {current.env.length > 0 && (
                <ul className="space-y-0.5 font-mono text-[11px] text-fg-muted">
                  {current.env.map(([k, v], i) => (
                    <li key={i} className="break-all">
                      <span className="text-accent">{k}</span>={v}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-fg-muted">
                config show
              </div>
              {configErr ? (
                <div className="rounded border border-stopped/40 bg-stopped/10 p-2 text-xs text-stopped">
                  {configErr}
                </div>
              ) : (
                <pre className="max-h-64 overflow-auto rounded bg-bg p-3 font-mono text-xs text-fg-term">
                  {config || "No config"}
                </pre>
              )}
            </div>
          </div>
        </section>

        <section ref={registriesSectionRef}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Registries
          </h2>
          <div className="space-y-3 rounded-md border border-border bg-bg-card p-4 text-sm">
            <p className="text-xs text-fg-muted">
              Registry credentials and endpoints used by{" "}
              <span className="font-mono">smolvm pack push</span> /{" "}
              <span className="font-mono">pull</span>. Saved files are validated by
              smolvm on its next invocation — malformed configs surface as errors then.
            </p>
            {registriesPath && (
              <div className="font-mono text-[11px] text-fg-muted break-all">
                {registriesPath}
              </div>
            )}
            <textarea
              value={registries}
              onChange={(e) => {
                setRegistries(e.target.value);
                if (registriesStatus) setRegistriesStatus(null);
              }}
              spellCheck={false}
              className="input min-h-[14rem] w-full resize-y font-mono text-xs"
              placeholder={`# No registries configured yet. Add a [registries."docker.io"] section to get started.`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={saveRegistries}
                disabled={savingRegistries || registries === registriesOriginal}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {savingRegistries ? "Saving…" : "Save"}
              </button>
              {registries !== registriesOriginal && !registriesStatus && (
                <span className="text-xs text-fg-muted">Unsaved changes</span>
              )}
              {registriesStatus && (
                <span className="text-xs text-accent">{registriesStatus}</span>
              )}
            </div>
            {registriesErr && (
              <div className="rounded border border-stopped/40 bg-stopped/10 p-2 text-xs text-stopped">
                {registriesErr}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Preferences
          </h2>
          <div className="space-y-3 rounded-md border border-border bg-bg-card p-4 text-sm">
            <label className="flex items-center justify-between gap-4">
              <div>
                <div>Machine list poll interval</div>
                <div className="text-xs text-fg-muted">
                  How often to refresh the machines list (seconds)
                </div>
              </div>
              <input
                type="number"
                min={1}
                max={60}
                value={prefs.pollIntervalSec}
                onChange={(e) =>
                  updatePrefs({ pollIntervalSec: Number(e.target.value) || 3 })
                }
                className="input w-24"
              />
            </label>
            <label className="flex items-center justify-between gap-4">
              <div>
                <div>Confirm destructive actions</div>
                <div className="text-xs text-fg-muted">
                  Prompt before deleting a machine
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs.confirmDestructive}
                onChange={(e) =>
                  updatePrefs({ confirmDestructive: e.target.checked })
                }
                className="h-4 w-4 accent-accent"
              />
            </label>
            <p className="text-xs text-fg-muted">
              Changes take effect immediately (poll interval applies on next page load).
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            About
          </h2>
          <div className="space-y-2 rounded-md border border-border bg-bg-card p-4 text-sm">
            <Row label="SmolVM Desktop" value="0.1.0" />
            <div className="flex flex-col gap-1">
              <button
                onClick={() => open("https://github.com/atomicdotdev/smolvm")}
                className="inline-flex w-fit items-center gap-1.5 text-accent hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                smolvm on GitHub
              </button>
              <button
                onClick={() =>
                  open("https://github.com/atomicdotdev/circuit-vm-tauri")
                }
                className="inline-flex w-fit items-center gap-1.5 text-accent hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                this app on GitHub
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Reset
          </h2>
          <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-bg-card p-4 text-sm">
            <div>
              <div>Start fresh</div>
              <div className="text-xs text-fg-muted">
                Clears the binary override (back to PATH smolvm), empties env vars,
                working directory, launcher prefix, and app preferences.
              </div>
            </div>
            <button
              onClick={() => setConfirmReset(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stopped/40 bg-stopped/10 px-3 py-1.5 text-sm text-stopped hover:bg-stopped/20"
            >
              <Eraser className="h-4 w-4" />
              Reset app data
            </button>
          </div>
        </section>
      </div>

      <BinaryChangeModal
        pending={pending}
        current={current}
        error={pendingError}
        applying={applying}
        onUpdate={(override) =>
          setPending(pending ? { ...pending, override } : null)
        }
        onCancel={() => {
          if (applying) return;
          setPending(null);
          setPendingError(null);
        }}
        onConfirm={applyChange}
      />

      {confirmReset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmReset(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-border bg-bg-card p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-stopped" />
              <h2 className="text-base font-semibold">Reset app data?</h2>
            </div>
            <p className="text-sm text-fg-muted">
              Clears the smolvm binary override (back to PATH <code>smolvm</code>),
              empties env vars, working directory, launcher prefix, and app
              preferences. Your machines and VM data are untouched.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmReset(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg"
              >
                Cancel
              </button>
              <button
                onClick={resetAll}
                className="rounded-md bg-stopped px-3 py-1.5 text-sm font-medium text-white hover:bg-stopped/90"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BinaryChangeModal({
  pending,
  current,
  error,
  applying,
  onUpdate,
  onCancel,
  onConfirm,
}: {
  pending: PendingChange | null;
  current: SmolvmBinary;
  error: string | null;
  applying: boolean;
  onUpdate: (next: BinaryOverride) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;

  const { override } = pending;
  const isReset = pending.mode === "reset";

  const pickBinary = async () => {
    const picked = await openDialog({ multiple: false, directory: false });
    if (typeof picked !== "string") return;
    onUpdate({ ...override, path: picked });
  };

  const pickCwd = async () => {
    const picked = await openDialog({ multiple: false, directory: true });
    if (typeof picked !== "string") return;
    onUpdate({ ...override, cwd: picked });
  };

  const applyCargoMakePreset = () => {
    onUpdate({
      ...override,
      path: CARGO_MAKE_PRESET.path ?? null,
      prefixArgs: [...(CARGO_MAKE_PRESET.prefixArgs ?? [])],
      argJoin: CARGO_MAKE_PRESET.argJoin ?? null,
      // Leave cwd and env untouched — the user still needs to point cwd at
      // the smolvm source tree, and env is not needed for cargo-make.
      env: [],
    });
  };

  const updateEnv = (i: number, key: string, value: string) => {
    const env = override.env.map((pair, j) =>
      j === i ? ([key, value] as [string, string]) : pair,
    );
    onUpdate({ ...override, env });
  };

  const addEnv = () =>
    onUpdate({ ...override, env: [...override.env, ["", ""]] });
  const removeEnv = (i: number) =>
    onUpdate({ ...override, env: override.env.filter((_, j) => j !== i) });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-border bg-bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-starting" />
          <h2 className="text-base font-semibold">
            {isReset ? "Reset smolvm binary?" : "Change smolvm binary"}
          </h2>
        </div>

        {isReset ? (
          <p className="text-sm text-fg-muted">
            This clears the override and falls back to the first smolvm found on your
            PATH, with no injected env vars.
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-fg-muted">
                Binary
              </div>
              <div className="flex gap-1.5">
                <input
                  value={override.path ?? ""}
                  onChange={(e) => onUpdate({ ...override, path: e.target.value })}
                  placeholder="/path/to/smolvm (blank = PATH lookup)"
                  className="input flex-1 font-mono"
                />
                <button
                  onClick={pickBinary}
                  title="Browse"
                  className="rounded-md border border-border bg-bg px-2 text-fg-muted hover:text-fg"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <div className="text-xs uppercase tracking-wide text-fg-muted">
                  Working directory
                </div>
                <span className="text-[11px] text-fg-muted">
                  relative env paths resolve from here
                </span>
              </div>
              <div className="flex gap-1.5">
                <input
                  value={override.cwd ?? ""}
                  onChange={(e) => onUpdate({ ...override, cwd: e.target.value })}
                  placeholder="/path/to/smolvm (blank = app default)"
                  className="input flex-1 font-mono"
                />
                <button
                  onClick={pickCwd}
                  title="Browse"
                  className="rounded-md border border-border bg-bg px-2 text-fg-muted hover:text-fg"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <div className="text-xs uppercase tracking-wide text-fg-muted">
                  Launcher prefix
                </div>
                <button
                  onClick={applyCargoMakePreset}
                  className="text-[11px] text-accent hover:underline"
                >
                  Use cargo-make preset
                </button>
              </div>
              <input
                value={override.prefixArgs.join(" ")}
                onChange={(e) =>
                  onUpdate({
                    ...override,
                    prefixArgs: e.target.value.split(/\s+/).filter(Boolean),
                  })
                }
                placeholder="e.g. make smolvm"
                className="input font-mono"
              />
              <p className="mt-1 text-[11px] text-fg-muted">
                Prepended before every command: <span className="font-mono">{"<binary> <prefix> <args>"}</span>. Leave blank for direct invocation.
              </p>
            </div>

            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-fg-muted">
                Join args with
              </div>
              <input
                value={override.argJoin ?? ""}
                onChange={(e) =>
                  onUpdate({
                    ...override,
                    argJoin: e.target.value.length > 0 ? e.target.value : null,
                  })
                }
                placeholder={"e.g. ;  (only for cargo-make)"}
                className="input font-mono"
              />
              <p className="mt-1 text-[11px] text-fg-muted">
                When set, user args are joined into a single token — needed by{" "}
                <span className="font-mono">cargo make</span> tasks that read{" "}
                <span className="font-mono">CARGO_MAKE_TASK_ARGS</span>.
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <div className="text-xs uppercase tracking-wide text-fg-muted">
                  Environment variables
                </div>
                <span className="text-[11px] text-fg-muted">
                  e.g. <span className="font-mono">DYLD_LIBRARY_PATH</span>,{" "}
                  <span className="font-mono">SMOLVM_AGENT_ROOTFS</span>
                </span>
              </div>
              <div className="space-y-1.5">
                {override.env.map(([k, v], i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      value={k}
                      onChange={(e) => updateEnv(i, e.target.value, v)}
                      placeholder="KEY"
                      className="input w-52 font-mono"
                    />
                    <span className="text-fg-muted">=</span>
                    <input
                      value={v}
                      onChange={(e) => updateEnv(i, k, e.target.value)}
                      placeholder="value"
                      className="input flex-1 font-mono"
                    />
                    <button
                      onClick={() => removeEnv(i)}
                      className="rounded-md p-1 text-fg-muted hover:bg-stopped/20 hover:text-stopped"
                      title="Remove"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addEnv}
                  className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-fg-muted hover:border-accent/60 hover:text-fg"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add variable
                </button>
              </div>
            </div>

            {envDiffHint(current.env, override.env)}
          </div>
        )}

        <p className="mt-3 text-sm text-starting">
          If the binary is missing, out-of-date, or from a different project — or if env
          vars don&apos;t match what the binary expects — machine management and exec
          sessions may fail or behave unexpectedly.
        </p>
        {error && (
          <div className="mt-3 rounded border border-stopped/40 bg-stopped/10 p-2 text-xs text-stopped">
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={applying}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={applying}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {applying ? "Applying…" : isReset ? "Reset" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatInvocation(bin: SmolvmBinary): string {
  const head =
    bin.path === "smolvm" && bin.prefix_args.length === 0
      ? DEFAULT_BINARY_LABEL
      : [bin.path, ...bin.prefix_args].join(" ");
  if (bin.arg_join) return `${head} <args joined by "${bin.arg_join}">`;
  return head;
}

function envDiffHint(current: EnvPairs, pending: EnvPairs) {
  const sameSize = current.length === pending.length;
  const sameAll =
    sameSize &&
    current.every(([k, v], i) => pending[i]?.[0] === k && pending[i]?.[1] === v);
  if (sameAll) return null;
  return (
    <p className="text-xs text-fg-muted">
      {current.length > 0 ? `Replacing ${current.length} var` : "No env vars currently set"}
      {current.length > 0 && current.length !== 1 ? "s" : ""}
      {" → "}
      {pending.length} var{pending.length === 1 ? "" : "s"}.
    </p>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-4 py-1">
      <div className="w-28 shrink-0 text-xs uppercase tracking-wide text-fg-muted">
        {label}
      </div>
      <div className={mono ? "truncate font-mono text-xs" : ""}>{value}</div>
    </div>
  );
}

export function getPollInterval(): number {
  return loadPrefs().pollIntervalSec * 1000;
}
export function getConfirmDestructive(): boolean {
  return loadPrefs().confirmDestructive;
}
