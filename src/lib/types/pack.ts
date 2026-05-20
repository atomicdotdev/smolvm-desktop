export interface Pack {
  path: string;
  name: string;
  size_bytes: number | null;
  image: string | null;
  created: string | null;
  digest: string | null;
  raw: unknown;
}

export interface CreatePackOpts {
  smolfile?: string | null;
  /** Stopped VM name to snapshot. Maps to `--from-vm`. */
  from_vm?: string | null;
  /** OCI image reference. Maps to `--image`. */
  image?: string | null;
  /** Output `.smolmachine` path. Required by smolvm. */
  output?: string | null;
}

export interface RunPackOpts {
  network: boolean;
}
