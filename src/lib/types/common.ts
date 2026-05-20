export interface PortMapping {
  host: number;
  guest: number;
  protocol: string;
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface VolumeMount {
  host_path: string;
  guest_path: string;
  readonly: boolean;
}
