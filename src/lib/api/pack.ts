import { invoke } from "@tauri-apps/api/core";
import type { CreatePackOpts, Pack, RunPackOpts } from "../types";

export const packApi = {
  listPacks: () => invoke<Pack[]>("list_packs"),
  /** Stat a local `.smolmachine` file. smolvm has no JSON inspect for local
   *  packs — use this for filesystem metadata only. */
  inspectPack: (path: string) => invoke<Pack>("inspect_pack", { path }),
  /** Inspect a registry artifact reference via `pack inspect <ref> --json`. */
  inspectRegistryPack: (reference: string) =>
    invoke<Pack>("inspect_registry_pack", { reference }),
  createPack: (opts: CreatePackOpts) => invoke<string>("create_pack", { opts }),
  runPack: (path: string, opts: RunPackOpts) =>
    invoke<string>("run_pack", { path, opts }),
  pushPack: (path: string, registryRef: string) =>
    invoke<string>("push_pack", { path, registryRef }),
  pullPack: (registryRef: string, output?: string) =>
    invoke<string>("pull_pack", { registryRef, output: output ?? null }),
  prunePacks: (dryRun: boolean, all: boolean, keep?: number) =>
    invoke<string>("prune_packs", { dryRun, all, keep: keep ?? null }),
};
