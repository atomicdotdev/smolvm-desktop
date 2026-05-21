import { invoke } from "@tauri-apps/api/core";
import type {
  Machine,
  MachineConfig,
  MachineInspect,
  MachinePatch,
  MonitorOverrides,
  RunConfig,
  SupervisorStatus,
} from "../types";

export const machineApi = {
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
  superviseStart: (name: string, overrides: MonitorOverrides) =>
    invoke<void>("supervise_start", { name, overrides }),
  superviseStop: (name: string) => invoke<void>("supervise_stop", { name }),
  superviseStatus: (name: string) =>
    invoke<SupervisorStatus | null>("supervise_status", { name }),
  listSupervised: () => invoke<string[]>("list_supervised"),
};
