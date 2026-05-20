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
  machine?: string | null;
  output?: string | null;
  name?: string | null;
}

export interface RunPackOpts {
  detach: boolean;
  network: boolean;
  name?: string | null;
}
