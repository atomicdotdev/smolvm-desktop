import { invoke } from "@tauri-apps/api/core";
import type {
  HealthStatus,
  MachineStats,
  SmolvmBinary,
  SystemInfo,
  SystemStats,
} from "../types";

export const systemApi = {
  machineStats: (name: string) =>
    invoke<MachineStats>("machine_stats", { name }),
  systemStats: () => invoke<SystemStats>("system_stats"),
  smolvmHealth: () => invoke<HealthStatus>("smolvm_health"),
  systemInfo: () => invoke<SystemInfo>("system_info"),
  smolvmConfig: () => invoke<string>("smolvm_config"),
  getRegistriesPath: () => invoke<string>("get_registries_path"),
  readRegistries: () => invoke<string>("read_registries"),
  writeRegistries: (content: string) =>
    invoke<void>("write_registries", { content }),
  registriesExample: () => invoke<string>("registries_example"),
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
