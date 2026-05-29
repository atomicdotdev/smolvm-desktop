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

export type View =
  | "machines"
  | "newMachine"
  | "images"
  | "volumes"
  | "packs"
  | "stats"
  | "settings";
