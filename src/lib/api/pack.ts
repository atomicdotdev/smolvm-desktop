import { invoke } from "@tauri-apps/api/core";
import type { CreatePackOpts, Pack, RunPackOpts } from "../types";

export const packApi = {
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
};
