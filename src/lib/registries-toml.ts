import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/**
 * Editor model for smolvm 0.8.0's unified `~/.config/smolvm/config.toml`.
 *
 * The file has three namespaces — `[cloud]`, `[machines]`, `[images]` — and
 * contains login-managed secrets the UI must NOT edit but MUST preserve on
 * round-trip (`[cloud]` `refresh_token`/`token_expires_at`; per-entry
 * `identity_token`/`refresh_token`/`expires_at`).
 *
 * Preservation strategy: we keep the FULL parsed object (`raw`) as the source
 * of truth. The structured editor reads/writes typed accessors over it, and on
 * serialize we mutate only the known editable paths on a deep clone of `raw`,
 * then stringify the whole thing. Any key we don't model — managed tokens,
 * future fields, unknown top-level tables — survives untouched.
 */

/** A registry entry (`[<ns>.registries."<host>"]`). Only username/password/
 *  password_env/mirror are user-editable; the rest are login-managed. */
export interface RegistryEntry {
  /** Hostname key, e.g. "docker.io". */
  host: string;
  username: string | null;
  /** Name of an env var holding the password. Preferred. */
  passwordEnv: string | null;
  /** Plaintext password — discouraged. */
  password: string | null;
  /** Optional mirror URL. */
  mirror: string | null;
}

/** One namespace's view: default registry + ordered entries. */
export interface RegistryNamespace {
  /** Hostname smolvm should use by default in this namespace, if any. */
  defaultRegistry: string | null;
  /** Registries in user-authored order (parse preserves insertion order). */
  registries: RegistryEntry[];
}

/** The two registry namespaces. `[machines]` and `[images]` share a shape. */
export type NamespaceKey = "machines" | "images";

/** `[cloud]` editable view. */
export interface CloudConfig {
  endpoint: string | null;
  apiKey: string | null;
}

/**
 * The structured editor model. `raw` is the complete parsed TOML object and is
 * the authoritative store of every key (including managed/unknown fields). The
 * typed views below are derived projections used by the UI.
 */
export interface SmolConfig {
  cloud: CloudConfig;
  machines: RegistryNamespace;
  images: RegistryNamespace;
  /** Full parsed TOML object — source of truth for preservation. */
  raw: Record<string, unknown>;
}

export const EMPTY_CONFIG: SmolConfig = {
  cloud: { endpoint: null, apiKey: null },
  machines: { defaultRegistry: null, registries: [] },
  images: { defaultRegistry: null, registries: [] },
  raw: {},
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep clone a plain JSON-ish object (TOML datetimes survive via structuredClone). */
function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function parseNamespace(nsRaw: unknown): RegistryNamespace {
  if (!isObject(nsRaw)) {
    return { defaultRegistry: null, registries: [] };
  }

  let defaultRegistry: string | null = null;
  const defaults = nsRaw["defaults"];
  if (isObject(defaults)) {
    defaultRegistry = asString(defaults["registry"]);
  }

  const registries: RegistryEntry[] = [];
  const regs = nsRaw["registries"];
  if (isObject(regs)) {
    for (const [host, value] of Object.entries(regs)) {
      if (!isObject(value)) continue;
      registries.push({
        host,
        username: asString(value["username"]),
        passwordEnv: asString(value["password_env"]),
        password: asString(value["password"]),
        mirror: asString(value["mirror"]),
      });
    }
  }

  return { defaultRegistry, registries };
}

/**
 * Parse a config.toml string into the structured model.
 * Throws if the TOML is malformed.
 */
export function parse(input: string): SmolConfig {
  const text = input.trim();
  if (text.length === 0) {
    return deepClone(EMPTY_CONFIG);
  }

  const raw = parseToml(input) as Record<string, unknown>;

  const cloudRaw = isObject(raw["cloud"]) ? raw["cloud"] : {};
  const cloud: CloudConfig = {
    endpoint: asString(cloudRaw["endpoint"]),
    apiKey: asString(cloudRaw["api_key"]),
  };

  return {
    cloud,
    machines: parseNamespace(raw["machines"]),
    images: parseNamespace(raw["images"]),
    raw,
  };
}

/**
 * Serialize the structured model back to a TOML string.
 *
 * Preservation: we deep-clone `cfg.raw` and mutate only the known editable
 * paths onto the clone, then stringify. Every managed/unknown field that the
 * UI doesn't touch is carried through verbatim. Editable fields the user
 * cleared are deleted; managed sibling keys are left intact.
 *
 * Round-tripping discards comments and source whitespace (smol-toml limitation)
 * but preserves all data, which is what smolvm cares about.
 */
export function stringify(cfg: SmolConfig): string {
  const out: Record<string, unknown> = deepClone(cfg.raw ?? {});

  // --- [cloud] ---
  const cloudTable = isObject(out["cloud"]) ? out["cloud"] : {};
  applyOptional(cloudTable, "endpoint", cfg.cloud.endpoint);
  applyOptional(cloudTable, "api_key", cfg.cloud.apiKey);
  if (Object.keys(cloudTable).length > 0) {
    out["cloud"] = cloudTable;
  } else {
    delete out["cloud"];
  }

  applyNamespace(out, "machines", cfg.machines);
  applyNamespace(out, "images", cfg.images);

  return stringifyToml(out);
}

/** Set key to value (trimmed-empty → delete), preserving sibling managed keys. */
function applyOptional(
  table: Record<string, unknown>,
  key: string,
  value: string | null,
): void {
  if (value !== null && value.length > 0) {
    table[key] = value;
  } else {
    delete table[key];
  }
}

/**
 * Reconcile a namespace's editable state onto the raw clone.
 * - `defaults.registry` is set/cleared (other defaults keys preserved).
 * - Each entry's editable fields are set/cleared on the existing raw entry
 *   table (so managed token keys on that entry survive), and brand-new entries
 *   get a fresh table. Entries removed in the UI are dropped from raw.
 */
function applyNamespace(
  out: Record<string, unknown>,
  key: NamespaceKey,
  ns: RegistryNamespace,
): void {
  const nsTable: Record<string, unknown> = isObject(out[key])
    ? (out[key] as Record<string, unknown>)
    : {};

  // defaults
  const defaults: Record<string, unknown> = isObject(nsTable["defaults"])
    ? (nsTable["defaults"] as Record<string, unknown>)
    : {};
  applyOptional(defaults, "registry", ns.defaultRegistry);
  if (Object.keys(defaults).length > 0) {
    nsTable["defaults"] = defaults;
  } else {
    delete nsTable["defaults"];
  }

  // registries — preserve managed fields on surviving entries.
  const existingRegs: Record<string, unknown> = isObject(nsTable["registries"])
    ? (nsTable["registries"] as Record<string, unknown>)
    : {};
  const nextRegs: Record<string, Record<string, unknown>> = {};
  for (const entry of ns.registries) {
    const prev = isObject(existingRegs[entry.host])
      ? (existingRegs[entry.host] as Record<string, unknown>)
      : {};
    const block: Record<string, unknown> = { ...prev };
    applyOptional(block, "username", entry.username);
    applyOptional(block, "password_env", entry.passwordEnv);
    applyOptional(block, "password", entry.password);
    applyOptional(block, "mirror", entry.mirror);
    nextRegs[entry.host] = block;
  }
  if (Object.keys(nextRegs).length > 0) {
    nsTable["registries"] = nextRegs;
  } else {
    delete nsTable["registries"];
  }

  if (Object.keys(nsTable).length > 0) {
    out[key] = nsTable;
  } else {
    delete out[key];
  }
}

function namespacesEqual(a: RegistryNamespace, b: RegistryNamespace): boolean {
  if (a.defaultRegistry !== b.defaultRegistry) return false;
  if (a.registries.length !== b.registries.length) return false;
  for (let i = 0; i < a.registries.length; i++) {
    const x = a.registries[i]!;
    const y = b.registries[i]!;
    if (
      x.host !== y.host ||
      x.username !== y.username ||
      x.passwordEnv !== y.passwordEnv ||
      x.password !== y.password ||
      x.mirror !== y.mirror
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Deep equality on the EDITABLE projection — used for the dirty bit. Managed
 * fields don't affect the dirty state (they're never edited), so comparing the
 * typed views is sufficient and avoids false-positives from `raw` identity.
 */
export function equals(a: SmolConfig, b: SmolConfig): boolean {
  if (a.cloud.endpoint !== b.cloud.endpoint) return false;
  if (a.cloud.apiKey !== b.cloud.apiKey) return false;
  return (
    namespacesEqual(a.machines, b.machines) &&
    namespacesEqual(a.images, b.images)
  );
}

/** Suggest an env var name for a hostname (e.g. "ghcr.io" → "GHCR_TOKEN"). */
export function suggestEnvVar(host: string): string {
  const trimmed = host.trim();
  if (trimmed.length === 0) return "REGISTRY_TOKEN";
  const lower = trimmed.toLowerCase();
  if (lower === "docker.io") return "DOCKER_HUB_TOKEN";
  if (lower === "ghcr.io") return "GHCR_TOKEN";
  if (lower === "gcr.io") return "GCR_KEY";
  if (lower.endsWith(".gcr.io") || lower.endsWith(".pkg.dev")) return "GCR_KEY";
  const head = lower.split(".")[0] ?? lower;
  const sanitized = head.replace(/[^a-z0-9]/g, "_").toUpperCase();
  return `${sanitized || "REGISTRY"}_TOKEN`;
}

/** Clone the full config (immutable updates). `raw` is deep-cloned so managed
 *  fields stay intact through edits. */
export function cloneConfig(cfg: SmolConfig): SmolConfig {
  return {
    cloud: { ...cfg.cloud },
    machines: {
      defaultRegistry: cfg.machines.defaultRegistry,
      registries: cfg.machines.registries.map((r) => ({ ...r })),
    },
    images: {
      defaultRegistry: cfg.images.defaultRegistry,
      registries: cfg.images.registries.map((r) => ({ ...r })),
    },
    raw: deepClone(cfg.raw ?? {}),
  };
}
