import { invoke } from "@tauri-apps/api/core";
import type {
  CreatePackOpts,
  HealthStatus,
  ImageEntry,
  Machine,
  MachineConfig,
  MachineInspect,
  MachinePatch,
  MachineStats,
  Pack,
  PruneResult,
  RunConfig,
  RunPackOpts,
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
  updateMachine: (name: string, patch: MachinePatch) =>
    invoke<Machine>("update_machine", { name, patch }),
  runMachine: (config: RunConfig) => invoke<string>("run_machine", { config }),
  listMachineImages: (name: string) =>
    invoke<ImageEntry[]>("list_machine_images", { name }),
  pruneMachineImages: (name: string, all: boolean, dryRun: boolean) =>
    invoke<PruneResult>("prune_machine_images", { name, all, dryRun }),
  machineStats: (name: string) => invoke<MachineStats>("machine_stats", { name }),
  systemStats: () => invoke<SystemStats>("system_stats"),
  smolvmHealth: () => invoke<HealthStatus>("smolvm_health"),
  systemInfo: () => invoke<SystemInfo>("system_info"),
  smolvmConfig: () => invoke<string>("smolvm_config"),
  getSmolvmBinary: () => invoke<SmolvmBinary>("get_smolvm_binary"),
  listPacks: () => invoke<Pack[]>("list_packs"),
  inspectPack: (path: string) => invoke<Pack>("inspect_pack", { path }),
  createPack: (opts: CreatePackOpts) => invoke<string>("create_pack", { opts }),
  runPack: (path: string, opts: RunPackOpts) =>
    invoke<string>("run_pack", { path, opts }),
  pushPack: (path: string, registryRef: string) =>
    invoke<string>("push_pack", { path, registryRef }),
  pullPack: (registryRef: string) =>
    invoke<string>("pull_pack", { registryRef }),
  prunePacks: (dryRun: boolean, all: boolean) =>
    invoke<string>("prune_packs", { dryRun, all }),
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
