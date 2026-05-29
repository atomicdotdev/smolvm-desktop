import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FolderOpen,
  Globe,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { defaultPackDir, defaultSmolfileDir } from "@/lib/paths";
import { api } from "@/lib/invoke";
import { useMachinesStore } from "@/hooks/useMachines";
import {
  RestartHealthEditor,
  emptyRestartHealthState,
  buildRestartSpec,
  buildHealthSpec,
  validateRestartHealth,
  type RestartHealthState,
} from "./RestartHealthEditor";
import type { EnvVar, PortMapping, VolumeMount } from "@/lib/types";

type Mode = "persistent" | "ephemeral";
type Source = "image" | "pack" | "smolfile";
type ErrorField =
  | "image"
  | "name"
  | "packPath"
  | "smolfilePath"
  | "gpuVram"
  | "env"
  | "policy"
  | null;

const noAutoCorrect = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  autoComplete: "off",
} as const;

interface Props {
  initialImage?: string | null;
  onCancel: () => void;
  onCreated: () => void;
}

export function NewMachinePage({ initialImage, onCancel, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("persistent");
  const [source, setSource] = useState<Source>("image");

  const [image, setImage] = useState(initialImage ?? "alpine");
  const [packPath, setPackPath] = useState("");
  const [smolfilePath, setSmolfilePath] = useState("");
  const [smolfileUrl, setSmolfileUrl] = useState("");
  const [fetchingSmolfile, setFetchingSmolfile] = useState(false);

  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [cpus, setCpus] = useState("");
  const [mem, setMem] = useState("");

  const [network, setNetwork] = useState(true);
  const [interactive, setInteractive] = useState(false);
  const [sshAgent, setSshAgent] = useState(false);
  const [allowHosts, setAllowHosts] = useState<string[]>([]);

  const [volumes, setVolumes] = useState<VolumeMount[]>([]);
  const [ports, setPorts] = useState<PortMapping[]>([]);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [workdir, setWorkdir] = useState("");
  const [initCommands, setInitCommands] = useState("");

  const [gpu, setGpu] = useState(false);
  const [gpuVram, setGpuVram] = useState("");

  const [policy, setPolicy] = useState<RestartHealthState>(
    emptyRestartHealthState,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ErrorField>(null);

  const imageRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const packPathRef = useRef<HTMLInputElement>(null);
  const smolfilePathRef = useRef<HTMLInputElement>(null);
  const gpuVramRef = useRef<HTMLInputElement>(null);
  const envSectionRef = useRef<HTMLElement>(null);
  const policySectionRef = useRef<HTMLElement>(null);

  const fail = (
    msg: string,
    field: NonNullable<ErrorField>,
    ref: React.RefObject<HTMLElement>,
  ) => {
    setError(msg);
    setErrorField(field);
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      (ref.current as HTMLInputElement | null)?.focus?.({ preventScroll: true });
    });
  };

  // Clear the field-level highlight (and error banner) once the user has
  // typed a value that would now pass the validation that flagged it.
  useEffect(() => {
    if (errorField === null) return;
    const fixed =
      (errorField === "image" && image.trim()) ||
      (errorField === "name" && name.trim()) ||
      (errorField === "packPath" && packPath.trim()) ||
      (errorField === "smolfilePath" && smolfilePath.trim()) ||
      (errorField === "gpuVram" &&
        (gpuVram.trim() === "" || Number(gpuVram) > 0));
    if (fixed) {
      setErrorField(null);
      setError(null);
    }
  }, [errorField, image, name, packPath, smolfilePath, gpuVram]);

  const errClass = (field: NonNullable<ErrorField>) =>
    errorField === field
      ? "border-stopped focus:border-stopped focus:ring-stopped"
      : "";

  const refresh = useMachinesStore((s) => s.refresh);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  const submit = async () => {
    setError(null);
    setErrorField(null);

    if (mode === "ephemeral" && !image.trim()) {
      fail("Image is required for ephemeral machines", "image", imageRef);
      return;
    }
    if (mode === "persistent" && !name.trim()) {
      fail("Name is required", "name", nameRef);
      return;
    }
    if (mode === "persistent" && source === "pack" && !packPath.trim()) {
      fail("Pack file is required", "packPath", packPathRef);
      return;
    }
    if (
      mode === "persistent" &&
      source === "smolfile" &&
      !smolfilePath.trim()
    ) {
      fail("Smolfile path is required", "smolfilePath", smolfilePathRef);
      return;
    }

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
      fail(
        `Invalid env var name: "${invalidEnv.key}"`,
        "env",
        envSectionRef,
      );
      return;
    }
    const validEnv = envVars
      .filter((e) => e.key.trim())
      .map((e) => ({ ...e, key: e.key.toUpperCase() }));
    const validAllowHosts = allowHosts.map((h) => h.trim()).filter(Boolean);

    const parsedGpuVram = gpuVram.trim() ? Number(gpuVram) : null;
    if (
      parsedGpuVram !== null &&
      (!Number.isFinite(parsedGpuVram) || parsedGpuVram <= 0)
    ) {
      fail("GPU VRAM must be a positive integer (MiB)", "gpuVram", gpuVramRef);
      return;
    }

    const policyError = validateRestartHealth(policy);
    if (policyError) {
      fail(policyError, "policy", policySectionRef);
      return;
    }

    const restartSpec = buildRestartSpec(policy);
    const healthSpec = buildHealthSpec(policy);
    const gpuOrNull = gpu ? true : null;
    const gpuVramOrNull = gpu ? parsedGpuVram : null;
    const workdirOrNull = workdir.trim() || null;

    setSubmitting(true);
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
          smolfile:
            source === "smolfile" ? smolfilePath.trim() || null : null,
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
      onCreated();
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  const fetchSmolfile = async () => {
    if (!smolfileUrl.trim() || fetchingSmolfile) return;
    setFetchingSmolfile(true);
    try {
      const path = await api.fetchSmolfileFromUrl(smolfileUrl.trim());
      setSmolfilePath(path);
      setSmolfileUrl("");
    } catch (err) {
      setError(String(err));
    } finally {
      setFetchingSmolfile(false);
    }
  };

  const submitLabel = submitting
    ? "Working…"
    : mode === "persistent"
      ? "Create"
      : "Run";

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-bg px-6 py-4">
        <button
          onClick={onCancel}
          title="Back to machines (Esc)"
          className="rounded-md p-1.5 text-fg-muted hover:bg-bg-card hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold">New machine</h1>
          <p className="text-sm text-fg-muted">
            Configure and create or run a smolvm.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-6">
          <Section
            title="Mode"
            description="Persistent machines survive restarts. Ephemeral runs one-shot."
          >
            <ModeToggle mode={mode} onChange={setMode} />
          </Section>

          {mode === "persistent" && (
            <Section
              title="Source"
              description="Build from an OCI image, a packaged .smolmachine, or a Smolfile recipe."
            >
              <SourceToggle source={source} onChange={setSource} />
              <div className="mt-3 space-y-3">
                {source === "image" && (
                  <Field
                    label="Image"
                    hint="optional (bare VM if empty)"
                  >
                    <input
                      {...noAutoCorrect}
                      ref={imageRef}
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      placeholder="alpine, postgres:16-alpine, ghcr.io/org/img"
                      className={`input ${errClass("image")}`}
                    />
                  </Field>
                )}
                {source === "pack" && (
                  <Field label="Pack file" hint=".smolmachine artifact">
                    <div className="flex gap-1">
                      <input
                        {...noAutoCorrect}
                        ref={packPathRef}
                        value={packPath}
                        onChange={(e) => setPackPath(e.target.value)}
                        placeholder="/path/to/pack.smolmachine"
                        className={`input flex-1 font-mono ${errClass("packPath")}`}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const picked = await openDialog({
                            multiple: false,
                            filters: [
                              {
                                name: "SmolVM pack",
                                extensions: ["smolmachine"],
                              },
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
                {source === "smolfile" && (
                  <>
                    <Field
                      label="Smolfile"
                      hint="recipe to materialize the machine"
                    >
                      <div className="flex gap-1">
                        <input
                          {...noAutoCorrect}
                          ref={smolfilePathRef}
                          value={smolfilePath}
                          onChange={(e) => setSmolfilePath(e.target.value)}
                          placeholder="/path/to/smolfile"
                          className={`input flex-1 font-mono ${errClass("smolfilePath")}`}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const picked = await openDialog({
                              multiple: false,
                              filters: [
                                {
                                  name: "Smolfile (TOML)",
                                  extensions: ["toml", "Smolfile"],
                                },
                                { name: "All files", extensions: ["*"] },
                              ],
                              defaultPath: await defaultSmolfileDir(),
                            });
                            if (typeof picked === "string")
                              setSmolfilePath(picked);
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
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                fetchSmolfile();
                              }
                            }}
                            placeholder="https://github.com/owner/repo/blob/main/example.smolfile"
                            className="input w-full pl-8 font-mono"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={fetchSmolfile}
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
                  </>
                )}
              </div>
            </Section>
          )}

          {mode === "ephemeral" && (
            <Section
              title="Source"
              description="Ephemeral runs always start from an OCI image."
            >
              <Field label="Image">
                <input
                  {...noAutoCorrect}
                  ref={imageRef}
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="alpine, postgres:16-alpine, ghcr.io/org/img"
                  className={`input ${errClass("image")}`}
                />
              </Field>
            </Section>
          )}

          <Section
            title="Basics"
            description="Name, command, and resource limits."
          >
            <div className="space-y-3">
              {mode === "persistent" && (
                <Field label="Name" hint="required">
                  <input
                    {...noAutoCorrect}
                    ref={nameRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-vm"
                    required
                    className={`input ${errClass("name")}`}
                  />
                </Field>
              )}
              {mode === "ephemeral" && (
                <Field
                  label="Command"
                  hint="optional — defaults to image entrypoint"
                >
                  <input
                    {...noAutoCorrect}
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="/bin/sh"
                    className="input font-mono"
                  />
                </Field>
              )}
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
            </div>
          </Section>

          <Section
            title="Network"
            description="Outbound networking, allow-listed hosts, and SSH agent forwarding."
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-4">
                <Checkbox
                  checked={network}
                  onChange={setNetwork}
                  label="Networking (--net)"
                />
                {mode === "ephemeral" && (
                  <Checkbox
                    checked={interactive}
                    onChange={setInteractive}
                    label="Interactive (-it)"
                  />
                )}
                <Checkbox
                  checked={sshAgent}
                  onChange={setSshAgent}
                  label="SSH agent"
                />
              </div>
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
                  onChange={(e) => setAllowHosts(e.target.value.split("\n"))}
                  rows={3}
                  placeholder={"registry.npmjs.org\napi.github.com"}
                  disabled={!network}
                  className="input resize-y font-mono disabled:opacity-50"
                />
              </Field>
            </div>
          </Section>

          <Section
            title="Mounts"
            description="Bind-mount host directories into the VM."
          >
            <VolumeEditor volumes={volumes} onChange={setVolumes} />
          </Section>

          <Section
            title="Ports"
            description="Expose ports from the VM to the host."
          >
            <PortEditor ports={ports} onChange={setPorts} />
          </Section>

          <Section
            title="Environment & workdir"
            description="Environment variables, working directory, and per-start init."
            sectionRef={envSectionRef}
            highlighted={errorField === "env"}
          >
            <div className="space-y-3">
              <EnvEditor env={envVars} onChange={setEnvVars} />
              <Field label="Working directory" hint="-w inside the VM">
                <input
                  {...noAutoCorrect}
                  value={workdir}
                  onChange={(e) => setWorkdir(e.target.value)}
                  placeholder="/workspace"
                  className="input font-mono"
                />
              </Field>
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
            </div>
          </Section>

          <Section
            title="GPU"
            description="Requires host support; upstream will error if unavailable."
          >
            <div className="space-y-3">
              <Checkbox
                checked={gpu}
                onChange={setGpu}
                label="Enable GPU passthrough (--gpu)"
              />
              <Field
                label="VRAM (MiB)"
                hint="optional — leave blank for auto"
              >
                <input
                  ref={gpuVramRef}
                  value={gpuVram}
                  onChange={(e) => setGpuVram(e.target.value)}
                  placeholder="auto"
                  inputMode="numeric"
                  disabled={!gpu}
                  className={`input disabled:opacity-50 ${errClass("gpuVram")}`}
                />
              </Field>
            </div>
          </Section>

          <Section
            title="Restart & health"
            description="Authored once at create time, enforced when a monitor is running."
            sectionRef={policySectionRef}
            highlighted={errorField === "policy"}
          >
            <RestartHealthEditor
              value={policy}
              onChange={setPolicy}
              smolfileSourceSelected={
                mode === "persistent" && source === "smolfile"
              }
            />
          </Section>

          {error && (
            <div className="rounded-md border border-stopped/40 bg-stopped/10 p-3 text-sm text-stopped">
              {error}
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-bg px-6 py-3">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-card disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </footer>
    </div>
  );
}

function Section({
  title,
  description,
  children,
  sectionRef,
  highlighted,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  sectionRef?: React.RefObject<HTMLElement>;
  highlighted?: boolean;
}) {
  return (
    <section
      ref={sectionRef}
      className={
        highlighted
          ? "rounded-md ring-2 ring-stopped ring-offset-4 ring-offset-bg"
          : undefined
      }
    >
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg">
          {title}
        </h2>
        <p className="text-xs text-fg-muted">{description}</p>
      </div>
      {children}
    </section>
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
    <div className="space-y-2">
      {ports.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={65535}
            value={p.host || ""}
            onChange={(e) => update(i, { host: Number(e.target.value) || 0 })}
            placeholder="host"
            className="input w-32 font-mono"
          />
          <span className="text-fg-muted">:</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={p.guest || ""}
            onChange={(e) => update(i, { guest: Number(e.target.value) || 0 })}
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
  );
}

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

export function isValidEnvKey(key: string): boolean {
  return ENV_KEY_RE.test(key);
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
                  invalid
                    ? "border-stopped focus:border-stopped focus:ring-stopped"
                    : ""
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
                Must start with a letter or <code>_</code>, then letters,
                digits, or <code>_</code>.
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
  );
}
