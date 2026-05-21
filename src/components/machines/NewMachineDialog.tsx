import { useEffect, useState } from "react";
import { Download, FolderOpen, Globe, Loader2, Plus, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { defaultPackDir, defaultSmolfileDir } from "@/lib/paths";
import { api } from "@/lib/invoke";
import { useMachinesStore } from "@/hooks/useMachines";
import type {
  EnvVar,
  HealthSpec,
  PortMapping,
  RestartPolicy,
  RestartSpec,
  VolumeMount,
} from "@/lib/types";

type Mode = "persistent" | "ephemeral";
type Source = "image" | "pack" | "smolfile";

/** Disable macOS/Safari auto-correct / auto-capitalize / spellcheck on
 * identifier-ish inputs (paths, hostnames, env keys, etc.). */
const noAutoCorrect = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  autoComplete: "off",
} as const;

interface Props {
  open: boolean;
  onClose: () => void;
  initialImage?: string | null;
  onCreated?: () => void;
}

export function NewMachineDialog({
  open,
  onClose,
  initialImage,
  onCreated,
}: Props) {
  const [mode, setMode] = useState<Mode>("persistent");
  const [source, setSource] = useState<Source>("image");
  const [packPath, setPackPath] = useState("");
  const [smolfilePath, setSmolfilePath] = useState("");
  const [smolfileUrl, setSmolfileUrl] = useState("");
  const [fetchingSmolfile, setFetchingSmolfile] = useState(false);
  const [image, setImage] = useState(initialImage ?? "alpine");

  useEffect(() => {
    if (open && initialImage) {
      setImage(initialImage);
      setSource("image");
    }
  }, [open, initialImage]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [name, setName] = useState("");
  const [network, setNetwork] = useState(true);
  const [interactive, setInteractive] = useState(false);
  const [sshAgent, setSshAgent] = useState(false);
  const [cpus, setCpus] = useState("");
  const [mem, setMem] = useState("");
  const [command, setCommand] = useState("");
  const [initCommands, setInitCommands] = useState("");
  const [volumes, setVolumes] = useState<VolumeMount[]>([]);
  const [ports, setPorts] = useState<PortMapping[]>([]);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [allowHosts, setAllowHosts] = useState<string[]>([]);
  const [workdir, setWorkdir] = useState("");
  const [gpu, setGpu] = useState(false);
  const [gpuVram, setGpuVram] = useState("");
  const [advanced, setAdvanced] = useState(false);
  // Restart & Health policy (Track A: authored at create time, persisted via
  // a generated `--smolfile`). Default "never" means we emit nothing for the
  // restart section.
  const [policyOpen, setPolicyOpen] = useState(false);
  const [restartPolicy, setRestartPolicy] = useState<RestartPolicy>("never");
  const [restartMaxRetries, setRestartMaxRetries] = useState("");
  const [restartMaxBackoff, setRestartMaxBackoff] = useState("");
  const [healthCmd, setHealthCmd] = useState("");
  const [healthInterval, setHealthInterval] = useState("");
  const [healthTimeout, setHealthTimeout] = useState("");
  const [healthRetries, setHealthRetries] = useState("");
  const [healthStartupGrace, setHealthStartupGrace] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useMachinesStore((s) => s.refresh);

  if (!open) return null;

  const resetForm = () => {
    setMode("persistent");
    setSource("image");
    setPackPath("");
    setSmolfilePath("");
    setImage(initialImage ?? "alpine");
    setName("");
    setNetwork(true);
    setInteractive(false);
    setSshAgent(false);
    setCpus("");
    setMem("");
    setCommand("");
    setInitCommands("");
    setVolumes([]);
    setPorts([]);
    setEnvVars([]);
    setAllowHosts([]);
    setWorkdir("");
    setGpu(false);
    setGpuVram("");
    setAdvanced(false);
    setPolicyOpen(false);
    setRestartPolicy("never");
    setRestartMaxRetries("");
    setRestartMaxBackoff("");
    setHealthCmd("");
    setHealthInterval("");
    setHealthTimeout("");
    setHealthRetries("");
    setHealthStartupGrace("");
    setError(null);
    setSubmitting(false);
  };

  const close = () => {
    resetForm();
    onClose();
  };

  const submit = async () => {
    if (mode === "ephemeral" && !image.trim()) {
      setError("Image is required for ephemeral machines");
      return;
    }
    if (mode === "persistent" && source === "pack" && !packPath.trim()) {
      setError("Pack file is required");
      return;
    }
    if (mode === "persistent" && source === "smolfile" && !smolfilePath.trim()) {
      setError("Smolfile path is required");
      return;
    }

    setError(null);
    setSubmitting(true);

    const parsedCpus = cpus.trim() ? Number(cpus) : null;
    const parsedMem = mem.trim() ? Number(mem) : null;
    const validVolumes = volumes.filter(
      (v) => v.host_path.trim() && v.guest_path.trim(),
    );
    const validPorts = ports.filter(
      (p) =>
        Number.isFinite(p.host) &&
        Number.isFinite(p.guest) &&
        p.host > 0 &&
        p.guest > 0,
    );
    const invalidEnv = envVars.find(
      (e) => e.key.length > 0 && !isValidEnvKey(e.key),
    );
    if (invalidEnv) {
      setError(`Invalid env var name: "${invalidEnv.key}"`);
      return;
    }
    const validEnv = envVars
      .filter((e) => e.key.trim())
      .map((e) => ({ ...e, key: e.key.toUpperCase() }));
    const validAllowHosts = allowHosts.map((h) => h.trim()).filter(Boolean);
    const workdirOrNull = workdir.trim() || null;
    const parsedGpuVram = gpuVram.trim() ? Number(gpuVram) : null;
    if (
      parsedGpuVram !== null &&
      (!Number.isFinite(parsedGpuVram) || parsedGpuVram <= 0)
    ) {
      setError("GPU VRAM must be a positive integer (MiB)");
      setSubmitting(false);
      return;
    }
    const gpuOrNull = gpu ? true : null;
    const gpuVramOrNull = gpu ? parsedGpuVram : null;

    // Build restart / health specs from the dialog inputs. Each helper
    // returns `null` when the user left the section blank, which the
    // backend interprets as "don't generate a policy Smolfile".
    const restartSpec = buildRestartSpec(
      restartPolicy,
      restartMaxRetries,
      restartMaxBackoff,
    );
    const healthSpec = buildHealthSpec(
      healthCmd,
      healthInterval,
      healthTimeout,
      healthRetries,
      healthStartupGrace,
    );
    const policyInvalidMsg = validatePolicyInputs(
      restartSpec,
      restartMaxRetries,
      restartMaxBackoff,
      healthCmd,
      healthInterval,
      healthTimeout,
      healthRetries,
      healthStartupGrace,
    );
    if (policyInvalidMsg) {
      setError(policyInvalidMsg);
      setSubmitting(false);
      return;
    }

    try {
      if (mode === "persistent") {
        await api.createMachine({
          name: name.trim() || null,
          image: source === "image" ? image.trim() || null : null,
          cpus: parsedCpus,
          memory_mb: parsedMem,
          network,
          ssh_agent: sshAgent,
          volumes: validVolumes,
          ports: validPorts,
          env: validEnv,
          allow_hosts: validAllowHosts,
          workdir: workdirOrNull,
          init_commands: initCommands
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
          gpu: gpuOrNull,
          gpu_vram_mib: gpuVramOrNull,
          from_pack: source === "pack" ? packPath.trim() || null : null,
          smolfile: source === "smolfile" ? smolfilePath.trim() || null : null,
          restart: restartSpec,
          health: healthSpec,
        });
      } else {
        await api.runMachine({
          image: image.trim(),
          cpus: parsedCpus,
          memory_mb: parsedMem,
          network,
          interactive,
          ssh_agent: sshAgent,
          volumes: validVolumes,
          ports: validPorts,
          env: validEnv,
          allow_hosts: validAllowHosts,
          workdir: workdirOrNull,
          command: command.trim() || null,
          gpu: gpuOrNull,
          gpu_vram_mib: gpuVramOrNull,
          restart: restartSpec,
          health: healthSpec,
        });
      }
      await refresh();
      onCreated?.();
      close();
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={close}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">New machine</h2>
          <button
            onClick={close}
            className="rounded-md p-1 text-fg-muted hover:bg-bg hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <ModeToggle mode={mode} onChange={setMode} />

          {mode === "persistent" && (
            <SourceToggle source={source} onChange={setSource} />
          )}

          {(mode === "ephemeral" || source === "image") && (
            <Field
              label="Image"
              hint={mode === "persistent" ? "optional (bare VM if empty)" : undefined}
            >
              <input
                {...noAutoCorrect}
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="alpine, postgres:16-alpine, ghcr.io/org/img"
                className="input"
              />
            </Field>
          )}

          {mode === "persistent" && source === "pack" && (
            <Field label="Pack file" hint=".smolmachine artifact">
              <div className="flex gap-1">
                <input
                  {...noAutoCorrect}
                  value={packPath}
                  onChange={(e) => setPackPath(e.target.value)}
                  placeholder="/path/to/pack.smolmachine"
                  className="input flex-1 font-mono"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const picked = await openDialog({
                      multiple: false,
                      filters: [
                        { name: "SmolVM pack", extensions: ["smolmachine"] },
                      ],
                      defaultPath: await defaultPackDir(),
                    });
                    if (typeof picked === "string") setPackPath(picked);
                  }}
                  title="Browse"
                  className="rounded-md border border-border bg-bg-card px-2 text-fg-muted hover:text-fg"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            </Field>
          )}

          {mode === "persistent" && source === "smolfile" && (
            <div className="space-y-2">
              <Field label="Smolfile" hint="recipe to materialize the machine">
                <div className="flex gap-1">
                  <input
                    {...noAutoCorrect}
                    value={smolfilePath}
                    onChange={(e) => setSmolfilePath(e.target.value)}
                    placeholder="/path/to/smolfile"
                    className="input flex-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const picked = await openDialog({
                        multiple: false,
                        filters: [
                          { name: "Smolfile (TOML)", extensions: ["toml", "Smolfile"] },
                          { name: "All files", extensions: ["*"] },
                        ],
                        defaultPath: await defaultSmolfileDir(),
                      });
                      if (typeof picked === "string") setSmolfilePath(picked);
                    }}
                    title="Browse"
                    className="rounded-md border border-border bg-bg-card px-2 text-fg-muted hover:text-fg"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                </div>
              </Field>
              <Field
                label="Or fetch from URL"
                hint="GitHub blob URLs are auto-converted to raw"
              >
                <div className="flex gap-1">
                  <div className="relative flex-1">
                    <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
                    <input
                      {...noAutoCorrect}
                      value={smolfileUrl}
                      onChange={(e) => setSmolfileUrl(e.target.value)}
                      onKeyDown={async (e) => {
                        if (
                          e.key === "Enter" &&
                          smolfileUrl.trim() &&
                          !fetchingSmolfile
                        ) {
                          e.preventDefault();
                          setFetchingSmolfile(true);
                          try {
                            const path = await api.fetchSmolfileFromUrl(
                              smolfileUrl.trim(),
                            );
                            setSmolfilePath(path);
                            setSmolfileUrl("");
                          } catch (err) {
                            setError(String(err));
                          } finally {
                            setFetchingSmolfile(false);
                          }
                        }
                      }}
                      placeholder="https://github.com/owner/repo/blob/main/example.smolfile"
                      className="input w-full pl-8 font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setFetchingSmolfile(true);
                      try {
                        const path = await api.fetchSmolfileFromUrl(
                          smolfileUrl.trim(),
                        );
                        setSmolfilePath(path);
                        setSmolfileUrl("");
                      } catch (err) {
                        setError(String(err));
                      } finally {
                        setFetchingSmolfile(false);
                      }
                    }}
                    disabled={!smolfileUrl.trim() || fetchingSmolfile}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 text-sm hover:bg-bg-card/70 disabled:opacity-50"
                  >
                    {fetchingSmolfile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Fetch
                  </button>
                </div>
              </Field>
            </div>
          )}

          {mode === "persistent" && (
            <Field label="Name" hint="optional — auto-generated if empty">
              <input
                {...noAutoCorrect}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-vm"
                className="input"
              />
            </Field>
          )}

          {mode === "ephemeral" && (
            <Field label="Command" hint="optional — defaults to image entrypoint">
              <input
                {...noAutoCorrect}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="/bin/sh"
                className="input font-mono"
              />
            </Field>
          )}


          <div className="flex flex-wrap gap-4 pt-1">
            <Checkbox checked={network} onChange={setNetwork} label="Networking (--net)" />
            {mode === "ephemeral" && (
              <Checkbox
                checked={interactive}
                onChange={setInteractive}
                label="Interactive (-it)"
              />
            )}
            <Checkbox checked={sshAgent} onChange={setSshAgent} label="SSH Agent" />
          </div>

          <button
            onClick={() => setAdvanced((a) => !a)}
            className="text-sm text-fg-muted hover:text-fg"
          >
            {advanced ? "▾" : "▸"} Advanced
          </button>

          {advanced && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="CPUs" hint="default 4">
                  <input
                    value={cpus}
                    onChange={(e) => setCpus(e.target.value)}
                    placeholder="4"
                    inputMode="numeric"
                    className="input"
                  />
                </Field>
                <Field label="Memory (MiB)" hint="default 8192">
                  <input
                    value={mem}
                    onChange={(e) => setMem(e.target.value)}
                    placeholder="8192"
                    inputMode="numeric"
                    className="input"
                  />
                </Field>
              </div>
              {mode === "persistent" && (
                <Field
                  label="Init commands"
                  hint="one per line, run on every start"
                >
                  <textarea
                    {...noAutoCorrect}
                    value={initCommands}
                    onChange={(e) => setInitCommands(e.target.value)}
                    rows={3}
                    placeholder={"apk add --no-cache python3\npip install requests"}
                    className="input resize-y font-mono"
                  />
                </Field>
              )}

              <VolumeEditor volumes={volumes} onChange={setVolumes} />
              <PortEditor ports={ports} onChange={setPorts} />
              <EnvEditor env={envVars} onChange={setEnvVars} />

              <Field
                label="Allow hosts"
                hint={
                  network
                    ? "egress-only hostnames, one per line"
                    : "requires Networking — enable above"
                }
              >
                <textarea
                  {...noAutoCorrect}
                  value={allowHosts.join("\n")}
                  onChange={(e) =>
                    setAllowHosts(e.target.value.split("\n"))
                  }
                  rows={2}
                  placeholder={"registry.npmjs.org\napi.github.com"}
                  disabled={!network}
                  className="input resize-y font-mono disabled:opacity-50"
                />
              </Field>

              <Field label="Working directory" hint="-w inside the VM">
                <input
                  {...noAutoCorrect}
                  value={workdir}
                  onChange={(e) => setWorkdir(e.target.value)}
                  placeholder="/workspace"
                  className="input font-mono"
                />
              </Field>

              <div className="space-y-2 rounded-md border border-border bg-bg/40 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">GPU acceleration</span>
                  <span className="text-xs text-fg-muted">
                    requires host support; upstream will error if unavailable
                  </span>
                </div>
                <Checkbox
                  checked={gpu}
                  onChange={setGpu}
                  label="Enable GPU passthrough (--gpu)"
                />
                <Field label="VRAM (MiB)" hint="optional — leave blank for auto">
                  <input
                    value={gpuVram}
                    onChange={(e) => setGpuVram(e.target.value)}
                    placeholder="auto"
                    inputMode="numeric"
                    disabled={!gpu}
                    className="input disabled:opacity-50"
                  />
                </Field>
              </div>
            </div>
          )}

          <button
            onClick={() => setPolicyOpen((o) => !o)}
            className="text-sm text-fg-muted hover:text-fg"
          >
            {policyOpen ? "▾" : "▸"} Restart & Health
          </button>

          {policyOpen && (
            <div className="space-y-3 rounded-md border border-border bg-bg/40 p-3">
              {mode === "persistent" && source === "smolfile" && (
                <div className="rounded-md border border-border bg-bg/50 px-2.5 py-1.5 text-xs text-fg-muted">
                  A Smolfile source was selected — these fields are ignored
                  here. Set <code>[restart]</code> and <code>[health]</code>{" "}
                  directly in the Smolfile.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Restart policy" hint="how monitor reacts on exit">
                  <select
                    value={restartPolicy}
                    onChange={(e) =>
                      setRestartPolicy(e.target.value as RestartPolicy)
                    }
                    className="input"
                  >
                    <option value="never">never</option>
                    <option value="always">always</option>
                    <option value="on-failure">on-failure</option>
                    <option value="unless-stopped">unless-stopped</option>
                  </select>
                </Field>
                <Field
                  label="Max retries"
                  hint="blank = smolvm default; 0 = unlimited"
                >
                  <input
                    value={restartMaxRetries}
                    onChange={(e) => setRestartMaxRetries(e.target.value)}
                    placeholder="default"
                    inputMode="numeric"
                    disabled={restartPolicy === "never"}
                    className="input disabled:opacity-50"
                  />
                </Field>
                <Field label="Max backoff (s)" hint="cap on retry backoff">
                  <input
                    value={restartMaxBackoff}
                    onChange={(e) => setRestartMaxBackoff(e.target.value)}
                    placeholder="default"
                    inputMode="numeric"
                    disabled={restartPolicy === "never"}
                    className="input disabled:opacity-50"
                  />
                </Field>
              </div>

              <Field
                label="Health check command"
                hint={
                  'runs as `sh -c "<cmd>"` inside the VM (blank = no check)'
                }
              >
                <input
                  {...noAutoCorrect}
                  value={healthCmd}
                  onChange={(e) => setHealthCmd(e.target.value)}
                  placeholder="curl -fsS http://127.0.0.1:8080/health"
                  className="input font-mono"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Interval (s)" hint="between checks">
                  <input
                    value={healthInterval}
                    onChange={(e) => setHealthInterval(e.target.value)}
                    placeholder="10"
                    inputMode="numeric"
                    disabled={!healthCmd.trim()}
                    className="input disabled:opacity-50"
                  />
                </Field>
                <Field label="Timeout (s)" hint="per-check timeout">
                  <input
                    value={healthTimeout}
                    onChange={(e) => setHealthTimeout(e.target.value)}
                    placeholder="2"
                    inputMode="numeric"
                    disabled={!healthCmd.trim()}
                    className="input disabled:opacity-50"
                  />
                </Field>
                <Field label="Retries" hint="failures before unhealthy">
                  <input
                    value={healthRetries}
                    onChange={(e) => setHealthRetries(e.target.value)}
                    placeholder="3"
                    inputMode="numeric"
                    disabled={!healthCmd.trim()}
                    className="input disabled:opacity-50"
                  />
                </Field>
                <Field
                  label="Startup grace (s)"
                  hint="ignore failures during boot"
                >
                  <input
                    value={healthStartupGrace}
                    onChange={(e) => setHealthStartupGrace(e.target.value)}
                    placeholder="20"
                    inputMode="numeric"
                    disabled={!healthCmd.trim()}
                    className="input disabled:opacity-50"
                  />
                </Field>
              </div>

              <p className="text-xs text-fg-muted">
                Policy is persisted into the VM record via a generated
                Smolfile. It only fires when something is actively running{" "}
                <code>smolvm machine monitor</code> against the VM.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-stopped/40 bg-stopped/10 p-3 text-sm text-stopped">
              {error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-border bg-bg px-5 py-3">
          <button
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-card"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {submitting ? "Working…" : mode === "persistent" ? "Create" : "Run"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-0 rounded-md border border-border p-0.5 text-sm">
      <ToggleOpt
        active={mode === "persistent"}
        onClick={() => onChange("persistent")}
        title="Persistent"
        subtitle="smolvm machine create — survives restarts"
      />
      <ToggleOpt
        active={mode === "ephemeral"}
        onClick={() => onChange("ephemeral")}
        title="Ephemeral"
        subtitle="smolvm machine run -d — one-shot"
      />
    </div>
  );
}

function SourceToggle({
  source,
  onChange,
}: {
  source: Source;
  onChange: (s: Source) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-0 rounded-md border border-border p-0.5 text-sm">
      <ToggleOpt
        active={source === "image"}
        onClick={() => onChange("image")}
        title="Image"
        subtitle="OCI reference"
      />
      <ToggleOpt
        active={source === "pack"}
        onClick={() => onChange("pack")}
        title="Pack file"
        subtitle=".smolmachine"
      />
      <ToggleOpt
        active={source === "smolfile"}
        onClick={() => onChange("smolfile")}
        title="Smolfile"
        subtitle="recipe"
      />
    </div>
  );
}

function ToggleOpt({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-2 text-left transition-colors ${
        active ? "bg-accent/20 text-fg" : "text-fg-muted hover:text-fg"
      }`}
    >
      <div className="font-medium">{title}</div>
      <div className="text-xs text-fg-muted">{subtitle}</div>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-fg-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function VolumeEditor({
  volumes,
  onChange,
}: {
  volumes: VolumeMount[];
  onChange: (v: VolumeMount[]) => void;
}) {
  const add = () =>
    onChange([...volumes, { host_path: "", guest_path: "", readonly: false }]);
  const update = (i: number, patch: Partial<VolumeMount>) =>
    onChange(volumes.map((v, j) => (i === j ? { ...v, ...patch } : v)));
  const remove = (i: number) => onChange(volumes.filter((_, j) => j !== i));

  const browse = async (i: number) => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") update(i, { host_path: picked });
  };

  return (
    <Field
      label="Volume mounts"
      hint="bind-mount host paths into the VM (-v HOST:GUEST[:ro])"
    >
      <div className="space-y-2">
        {volumes.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="flex flex-1 gap-1">
              <input
                {...noAutoCorrect}
                value={v.host_path}
                onChange={(e) => update(i, { host_path: e.target.value })}
                placeholder="/host/path"
                className="input flex-1 font-mono"
              />
              <button
                type="button"
                onClick={() => browse(i)}
                title="Browse"
                className="rounded-md border border-border bg-bg-card px-2 text-fg-muted hover:text-fg"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
            <span className="text-fg-muted">:</span>
            <input
              {...noAutoCorrect}
              value={v.guest_path}
              onChange={(e) => update(i, { guest_path: e.target.value })}
              placeholder="/guest/path"
              className="input flex-1 font-mono"
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={v.readonly}
                onChange={(e) => update(i, { readonly: e.target.checked })}
                className="h-3.5 w-3.5 accent-accent"
              />
              ro
            </label>
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remove"
              className="rounded-md p-1 text-fg-muted hover:bg-stopped/20 hover:text-stopped"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-fg-muted hover:border-accent/60 hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          Add mount
        </button>
      </div>
    </Field>
  );
}

function PortEditor({
  ports,
  onChange,
}: {
  ports: PortMapping[];
  onChange: (v: PortMapping[]) => void;
}) {
  const add = () =>
    onChange([...ports, { host: 0, guest: 0, protocol: "tcp" }]);
  const update = (i: number, patch: Partial<PortMapping>) =>
    onChange(ports.map((p, j) => (i === j ? { ...p, ...patch } : p)));
  const remove = (i: number) => onChange(ports.filter((_, j) => j !== i));

  return (
    <Field
      label="Port mappings"
      hint="expose VM ports to the host (-p HOST:GUEST)"
    >
      <div className="space-y-2">
        {ports.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={65535}
              value={p.host || ""}
              onChange={(e) =>
                update(i, { host: Number(e.target.value) || 0 })
              }
              placeholder="host"
              className="input w-32 font-mono"
            />
            <span className="text-fg-muted">:</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={p.guest || ""}
              onChange={(e) =>
                update(i, { guest: Number(e.target.value) || 0 })
              }
              placeholder="guest"
              className="input w-32 font-mono"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remove"
              className="ml-auto rounded-md p-1 text-fg-muted hover:bg-stopped/20 hover:text-stopped"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-fg-muted hover:border-accent/60 hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          Add port
        </button>
      </div>
    </Field>
  );
}

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

export function isValidEnvKey(key: string): boolean {
  return ENV_KEY_RE.test(key);
}

/** Parse a possibly-blank string as a non-negative integer. Empty/blank → null. */
function parseOptUInt(s: string): number | null | "invalid" {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) return "invalid";
  return n;
}

function buildRestartSpec(
  policy: RestartPolicy,
  maxRetries: string,
  maxBackoff: string,
): RestartSpec | null {
  if (policy === "never") return null;
  const spec: RestartSpec = { policy };
  const r = parseOptUInt(maxRetries);
  if (typeof r === "number") spec.max_retries = r;
  const b = parseOptUInt(maxBackoff);
  if (typeof b === "number") spec.max_backoff_secs = b;
  return spec;
}

function buildHealthSpec(
  cmd: string,
  interval: string,
  timeout: string,
  retries: string,
  startupGrace: string,
): HealthSpec | null {
  const c = cmd.trim();
  if (!c) return null;
  const spec: HealthSpec = { exec: ["sh", "-c", c] };
  const i = parseOptUInt(interval);
  if (typeof i === "number") spec.interval_secs = i;
  const t = parseOptUInt(timeout);
  if (typeof t === "number") spec.timeout_secs = t;
  const r = parseOptUInt(retries);
  if (typeof r === "number") spec.retries = r;
  const g = parseOptUInt(startupGrace);
  if (typeof g === "number") spec.startup_grace_secs = g;
  return spec;
}

/** Returns an error message if any populated policy field failed to parse. */
function validatePolicyInputs(
  restartSpec: RestartSpec | null,
  maxRetries: string,
  maxBackoff: string,
  healthCmd: string,
  interval: string,
  timeout: string,
  retries: string,
  startupGrace: string,
): string | null {
  if (restartSpec) {
    if (parseOptUInt(maxRetries) === "invalid")
      return "Restart max retries must be a non-negative integer";
    if (parseOptUInt(maxBackoff) === "invalid")
      return "Restart max backoff must be a non-negative integer (seconds)";
  }
  if (healthCmd.trim()) {
    if (parseOptUInt(interval) === "invalid")
      return "Health interval must be a non-negative integer (seconds)";
    if (parseOptUInt(timeout) === "invalid")
      return "Health timeout must be a non-negative integer (seconds)";
    if (parseOptUInt(retries) === "invalid")
      return "Health retries must be a non-negative integer";
    if (parseOptUInt(startupGrace) === "invalid")
      return "Health startup grace must be a non-negative integer (seconds)";
  }
  return null;
}

function EnvEditor({
  env,
  onChange,
}: {
  env: EnvVar[];
  onChange: (v: EnvVar[]) => void;
}) {
  const add = () => onChange([...env, { key: "", value: "" }]);
  const update = (i: number, patch: Partial<EnvVar>) =>
    onChange(env.map((e, j) => (i === j ? { ...e, ...patch } : e)));
  const remove = (i: number) => onChange(env.filter((_, j) => j !== i));

  return (
    <Field label="Environment variables" hint="-e KEY=VALUE passed to the VM">
      <div className="space-y-2">
        {env.map((e, i) => {
          const keyTouched = e.key.length > 0;
          const invalid = keyTouched && !isValidEnvKey(e.key);
          return (
            <div key={i}>
              <div className="flex items-center gap-1.5">
                <input
                  {...noAutoCorrect}
                  value={e.key}
                  onChange={(ev) =>
                    update(i, { key: ev.target.value.toUpperCase() })
                  }
                  placeholder="KEY"
                  aria-invalid={invalid}
                  className={`input w-52 font-mono uppercase ${
                    invalid ? "border-stopped focus:border-stopped focus:ring-stopped" : ""
                  }`}
                />
                <span className="text-fg-muted">=</span>
                <input
                  {...noAutoCorrect}
                  value={e.value}
                  onChange={(ev) => update(i, { value: ev.target.value })}
                  placeholder="value"
                  className="input flex-1 font-mono"
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title="Remove"
                  className="rounded-md p-1 text-fg-muted hover:bg-stopped/20 hover:text-stopped"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {invalid && (
                <div className="mt-0.5 pl-1 text-[11px] text-stopped">
                  Must start with a letter or <code>_</code>, then letters, digits,
                  or <code>_</code>.
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-fg-muted hover:border-accent/60 hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          Add variable
        </button>
      </div>
    </Field>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border bg-bg accent-accent"
      />
      {label}
    </label>
  );
}
