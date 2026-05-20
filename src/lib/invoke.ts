import { invoke } from "@tauri-apps/api/core";
import type {
  HealthStatus,
  ImageSummary,
  Machine,
  MachineConfig,
  MachineInspect,
  MachineStats,
  RunConfig,
  SmolvmBinary,
  SystemInfo,
  SystemStats,
} from "./types";

export const api = {
  listMachines: () => invoke<Machine[]>("list_machines"),
  startMachine: (name: string) => invoke<void>("start_machine", { name }),
  stopMachine: (name: string) => invoke<void>("stop_machine", { name }),
  deleteMachine: (name: string) => invoke<void>("delete_machine", { name }),
  inspectMachine: (name: string) =>
    invoke<MachineInspect>("inspect_machine", { name }),
  createMachine: (config: MachineConfig) =>
    invoke<Machine>("create_machine", { config }),
  runMachine: (config: RunConfig) => invoke<string>("run_machine", { config }),
  listImages: () => invoke<ImageSummary[]>("list_images"),
  machineStats: (name: string) => invoke<MachineStats>("machine_stats", { name }),
  systemStats: () => invoke<SystemStats>("system_stats"),
  smolvmHealth: () => invoke<HealthStatus>("smolvm_health"),
  systemInfo: () => invoke<SystemInfo>("system_info"),
  smolvmConfig: () => invoke<string>("smolvm_config"),
  getSmolvmBinary: () => invoke<SmolvmBinary>("get_smolvm_binary"),
  setSmolvmBinary: (
    path: string | null,
    env: [string, string][],
    cwd: string | null,
    prefixArgs: string[],
    argJoin: string | null,
  ) =>
    invoke<HealthStatus>("set_smolvm_binary", {
      path,
      env,
      cwd,
      prefixArgs,
      argJoin,
    }),
};
