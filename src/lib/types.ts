export type MachineStatus =
  | "running"
  | "stopped"
  | "starting"
  | "created"
  | "exited"
  | "unreachable"
  | "unknown";

export interface PortMapping {
  host: number;
  guest: number;
  protocol: string;
}

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
}

export interface HealthStatus {
  healthy: boolean;
  version: string | null;
  error: string | null;
}

export interface SystemInfo {
  smolvm_version: string | null;
  smolvm_path: string | null;
}

export interface SmolvmBinary {
  path: string;
  env: [string, string][];
  cwd: string | null;
  prefix_args: string[];
  arg_join: string | null;
}

export interface MachineInspect {
  name: string;
  raw: unknown;
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface VolumeMount {
  host_path: string;
  guest_path: string;
  readonly: boolean;
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

export interface Pack {
  path: string;
  name: string;
  size_bytes: number | null;
  image: string | null;
  created: string | null;
  digest: string | null;
  raw: unknown;
}

export interface CreatePackOpts {
  smolfile?: string | null;
  machine?: string | null;
  output?: string | null;
  name?: string | null;
}

export interface RunPackOpts {
  detach: boolean;
  network: boolean;
  name?: string | null;
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
}

export type View =
  | "machines"
  | "images"
  | "volumes"
  | "packs"
  | "stats"
  | "settings";

/**
 * One cached layer / image record reported by `smolvm machine images --json`.
 * Field names are permissive because the live JSON shape isn't pinned down
 * in this repo yet; the backend captures common keys and stashes the full
 * object in `raw` as a fallback.
 */
export interface ImageEntry {
  digest: string | null;
  reference: string | null;
  size_bytes: number | null;
  created: string | null;
  in_use: boolean | null;
  raw: unknown;
}

export interface PruneResult {
  output: string;
  dry_run: boolean;
  all: boolean;
  removed_count: number | null;
  reclaimed_bytes: number | null;
}

export interface MachineStats {
  name: string;
  pid: number | null;
  cpu_percent: number;
  memory_bytes: number;
  timestamp: number;
  alive: boolean;
}

export interface SystemStats {
  per_machine: MachineStats[];
  total_cpu_percent: number;
  total_memory_bytes: number;
  host_memory_total_bytes: number;
  host_cpu_count: number;
  timestamp: number;
}
