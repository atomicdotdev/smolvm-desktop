import { invoke } from "@tauri-apps/api/core";
import type { ImageEntry, PruneResult } from "../types";

export const imageApi = {
  listMachineImages: (name: string) =>
    invoke<ImageEntry[]>("list_machine_images", { name }),
  pruneMachineImages: (name: string, all: boolean, dryRun: boolean) =>
    invoke<PruneResult>("prune_machine_images", { name, all, dryRun }),
};
