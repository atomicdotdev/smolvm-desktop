import { invoke } from "@tauri-apps/api/core";

export const smolfileApi = {
  /** Download a smolfile from a URL into ~/Documents/smolvm-smolfiles/.
   *  GitHub `github.com/.../blob/...` URLs are auto-rewritten to raw. */
  fetchSmolfileFromUrl: (url: string) =>
    invoke<string>("fetch_smolfile_from_url", { url }),
};
