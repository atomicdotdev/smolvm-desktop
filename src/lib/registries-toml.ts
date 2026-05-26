import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/**
 * In-memory shape of the registries.toml file used by the structured editor.
 * This intentionally strips down to the fields the UI cares about — anything
 * else in the file is dropped on round-trip (parse → stringify).
 */
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

export interface RegistriesConfig {
  /** Hostname that smolvm should use by default, if any. */
  defaultRegistry: string | null;
  /** Registries in user-authored order (parse preserves insertion order). */
  registries: RegistryEntry[];
}

export const EMPTY_CONFIG: RegistriesConfig = {
  defaultRegistry: null,
  registries: [],
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Parse a registries.toml string into the structured config.
 * Throws if the TOML is malformed.
 */
export function parse(input: string): RegistriesConfig {
  const text = input.trim();
  if (text.length === 0) {
    return { defaultRegistry: null, registries: [] };
  }

  const raw = parseToml(input) as Record<string, unknown>;

  let defaultRegistry: string | null = null;
  const defaults = raw["defaults"];
  if (defaults && typeof defaults === "object") {
    defaultRegistry = asString((defaults as Record<string, unknown>)["registry"]);
  }

  const registries: RegistryEntry[] = [];
  const regs = raw["registries"];
  if (regs && typeof regs === "object") {
    for (const [host, value] of Object.entries(regs as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const obj = value as Record<string, unknown>;
      registries.push({
        host,
        username: asString(obj["username"]),
        passwordEnv: asString(obj["password_env"]),
        password: asString(obj["password"]),
        mirror: asString(obj["mirror"]),
      });
    }
  }

  return { defaultRegistry, registries };
}

/**
 * Serialize a structured config back to a TOML string.
 * Round-tripping discards comments and arbitrary formatting from the source.
 */
export function stringify(cfg: RegistriesConfig): string {
  const out: Record<string, unknown> = {};

  if (cfg.defaultRegistry && cfg.defaultRegistry.length > 0) {
    out["defaults"] = { registry: cfg.defaultRegistry };
  }

  if (cfg.registries.length > 0) {
    const regs: Record<string, Record<string, string>> = {};
    for (const entry of cfg.registries) {
      const block: Record<string, string> = {};
      if (entry.username !== null) block["username"] = entry.username;
      if (entry.passwordEnv !== null) block["password_env"] = entry.passwordEnv;
      if (entry.password !== null) block["password"] = entry.password;
      if (entry.mirror !== null) block["mirror"] = entry.mirror;
      regs[entry.host] = block;
    }
    out["registries"] = regs;
  }

  return stringifyToml(out);
}

/**
 * Deep equality on parsed structures — used to compute the dirty bit.
 * Order of registries matters (it's user-facing).
 */
export function equals(a: RegistriesConfig, b: RegistriesConfig): boolean {
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

/** Suggest an env var name for a hostname (e.g. "ghcr.io" → "GHCR_TOKEN"). */
export function suggestEnvVar(host: string): string {
  const trimmed = host.trim();
  if (trimmed.length === 0) return "REGISTRY_TOKEN";
  // Well-known shortcuts that match smolvm's docs.
  const lower = trimmed.toLowerCase();
  if (lower === "docker.io") return "DOCKER_HUB_TOKEN";
  if (lower === "ghcr.io") return "GHCR_TOKEN";
  if (lower === "gcr.io") return "GCR_KEY";
  if (lower.endsWith(".gcr.io") || lower.endsWith(".pkg.dev")) return "GCR_KEY";
  // Strip the first label, uppercase, replace non-alphanumeric with _.
  const head = lower.split(".")[0] ?? lower;
  const sanitized = head.replace(/[^a-z0-9]/g, "_").toUpperCase();
  return `${sanitized || "REGISTRY"}_TOKEN`;
}

/** Convenience: clone a config (immutable updates). */
export function cloneConfig(cfg: RegistriesConfig): RegistriesConfig {
  return {
    defaultRegistry: cfg.defaultRegistry,
    registries: cfg.registries.map((r) => ({ ...r })),
  };
}
