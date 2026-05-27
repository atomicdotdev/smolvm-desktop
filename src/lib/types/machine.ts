import type { EnvVar, PortMapping, VolumeMount } from "./common";

/** Restart policy persisted into the `[restart]` Smolfile section. */
export type RestartPolicy = "never" | "always" | "on-failure" | "unless-stopped";

/**
 * Authored-at-create-time restart spec. Only `policy` is required; missing
 * fields fall back to smolvm's defaults.
 */
export interface RestartSpec {
  policy: RestartPolicy;
  max_retries?: number | null;
  max_backoff_secs?: number | null;
}

/**
 * Health-check spec. Durations are stored as integer seconds and the backend
 * serializes them as `"<N>s"` duration strings.
 *
 * The UI typically wraps a single text command as `["sh", "-c", "<cmd>"]`.
 */
export interface HealthSpec {
  exec: string[];
  interval_secs?: number | null;
  timeout_secs?: number | null;
  retries?: number | null;
  startup_grace_secs?: number | null;
}

export type MachineStatus =
  | "running"
  | "stopped"
  | "starting"
  | "created"
  | "exited"
  | "unreachable"
  | "unknown";

export interface Machine {
  name: string;
  status: MachineStatus;
  image: string | null;
  created: string | null;
  ports: PortMapping[];
  cpus: number | null;
  memory_mb: number | null;
  network: boolean;
  pid: number | null;
  env_count: number;
  mounts: VolumeMount[];
  // Persisted restart/health policy (smolvm >= 0.8.0; null on older versions).
  restart_policy: string | null;
  restart_max_retries: number | null;
  restart_count: number | null;
  health_cmd: string | null;
  health_interval_secs: number | null;
  health_timeout_secs: number | null;
  health_retries: number | null;
  health_startup_grace_secs: number | null;
}

export interface MachineInspect {
  name: string;
  raw: unknown;
}

export interface MachineConfig {
  name: string | null;
  image: string | null;
  cpus: number | null;
  memory_mb: number | null;
  network: boolean;
  ssh_agent: boolean;
  volumes: VolumeMount[];
  ports: PortMapping[];
  env: EnvVar[];
  allow_hosts: string[];
  init_commands: string[];
  workdir: string | null;
  gpu: boolean | null;
  gpu_vram_mib: number | null;
  /** Path to a .smolmachine pack to import from. */
  from_pack?: string | null;
  /** Path to a smolfile to materialize the machine from. */
  smolfile?: string | null;
  /**
   * Optional restart policy. When set, the backend generates a tiny
   * policy-only Smolfile and appends `--smolfile <tempfile>` to the
   * `machine create` argv.
   */
  restart?: RestartSpec | null;
  /** Optional health-check spec; same mechanism as `restart`. */
  health?: HealthSpec | null;
}

export interface MachinePatch {
  cpus?: number | null;
  memory_mb?: number | null;
  network?: boolean | null;
  workdir?: string | null;
  gpu?: boolean | null;
  gpu_vram_mib?: number | null;
  storage_gib?: number | null;
  overlay_gib?: number | null;
  add_volumes?: VolumeMount[];
  remove_volumes?: string[];
  add_ports?: PortMapping[];
  remove_ports?: string[];
  add_env?: EnvVar[];
  remove_env?: string[];
}

/** Per-session overrides for `smolvm machine monitor`. All fields optional. */
export interface MonitorOverrides {
  restart?: string | null;
  health_cmd?: string | null;
  health_timeout_secs?: number | null;
  interval_secs?: number | null;
  health_retries?: number | null;
}

export interface SupervisorStatus {
  machine: string;
  overrides: MonitorOverrides;
  started_at_ms: number;
  exit_code: number | null;
  log_tail: string[];
}

export interface RunConfig {
  image: string;
  cpus: number | null;
  memory_mb: number | null;
  network: boolean;
  interactive: boolean;
  ssh_agent: boolean;
  volumes: VolumeMount[];
  ports: PortMapping[];
  env: EnvVar[];
  allow_hosts: string[];
  workdir: string | null;
  command: string | null;
  gpu: boolean | null;
  gpu_vram_mib: number | null;
  /** Optional restart policy (same encoding as MachineConfig). */
  restart?: RestartSpec | null;
  /** Optional health-check spec (same encoding as MachineConfig). */
  health?: HealthSpec | null;
}
