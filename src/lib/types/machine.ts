import type { EnvVar, PortMapping, VolumeMount } from "./common";

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
