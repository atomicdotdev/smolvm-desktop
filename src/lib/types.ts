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
}

export type View = "machines" | "images" | "volumes" | "stats" | "settings";

export interface ImageSummary {
  reference: string;
  machines: string[];
  running_count: number;
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
