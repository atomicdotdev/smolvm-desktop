/**
 * One cached layer / image record reported by `smolvm machine images --json`.
 * Field names are permissive because the live JSON shape isn't pinned down
 * in this repo yet; the backend captures common keys and stashes the full
 * object in `raw` as a fallback.
 */
export interface ImageEntry {
  digest: string | null;
  reference: string | null;
  size_bytes: number | null;
  created: string | null;
  in_use: boolean | null;
  raw: unknown;
}

export interface PruneResult {
  output: string;
  dry_run: boolean;
  all: boolean;
  removed_count: number | null;
  reclaimed_bytes: number | null;
}
