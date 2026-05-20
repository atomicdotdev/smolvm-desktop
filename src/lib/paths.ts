import { documentDir, homeDir, join } from "@tauri-apps/api/path";

/**
 * Default directory we suggest to the user for storing `.smolmachine` packs.
 * Mirrors the second scan path in the Rust `list_packs` backend so the file
 * picker opens to the same place we expect packs to live.
 *
 * Falls back through ~/Documents → ~/ if the canonical location can't be
 * resolved (rare).
 */
export async function defaultPackDir(): Promise<string> {
  try {
    return await join(await documentDir(), "smolvm-packs");
  } catch {
    try {
      return await documentDir();
    } catch {
      return await homeDir();
    }
  }
}

/** Workspace default for smolfile pickers — ~/Documents, falling back to ~/. */
export async function defaultSmolfileDir(): Promise<string> {
  try {
    return await documentDir();
  } catch {
    return await homeDir();
  }
}
