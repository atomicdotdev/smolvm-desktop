// Round-trip + preservation tests for the unified config.toml model.
// No test runner is wired into the repo; run ad-hoc with `bun test` (bun has a
// built-in test runner) from the worktree root. Imports `smol-toml` directly.
import { expect, test } from "bun:test";
import { parse as parseToml } from "smol-toml";
import {
  cloneConfig,
  equals,
  parse,
  stringify,
  type SmolConfig,
} from "./registries-toml";

const FIXTURE = `[cloud]
endpoint = "https://api.smolmachines.com"
api_key = "smk_testkey"

[images.defaults]
registry = "docker.io"
[images.registries."docker.io"]
username = "imguser"
password_env = "DOCKER_HUB_TOKEN"
[images.registries."ghcr.io"]
username = "ghuser"
password_env = "GHCR_TOKEN"
mirror = "mirror.example.com"

[machines.defaults]
registry = "registry.smolmachines.com"
[machines.registries."registry.smolmachines.com"]
username = "token"
password = "jwt-here"
`;

test("parse extracts the editable projection", () => {
  const cfg = parse(FIXTURE);
  expect(cfg.cloud.endpoint).toBe("https://api.smolmachines.com");
  expect(cfg.cloud.apiKey).toBe("smk_testkey");
  expect(cfg.images.defaultRegistry).toBe("docker.io");
  expect(cfg.images.registries.map((r) => r.host)).toEqual([
    "docker.io",
    "ghcr.io",
  ]);
  expect(cfg.images.registries[1]!.mirror).toBe("mirror.example.com");
  expect(cfg.machines.defaultRegistry).toBe("registry.smolmachines.com");
  expect(cfg.machines.registries[0]!.password).toBe("jwt-here");
});

test("parse -> stringify -> parse is lossless on the confirmed fixture", () => {
  const cfg = parse(FIXTURE);
  const out = stringify(cfg);
  const reparsed = parseToml(out);
  // Compare against the parsed fixture object (TOML semantics, not bytes).
  expect(reparsed).toEqual(parseToml(FIXTURE));
});

test("managed fields survive a sibling edit (key correctness property)", () => {
  const withManaged = `[cloud]
endpoint = "https://api.smolmachines.com"
api_key = "smk_old"
refresh_token = "rt_secret_cloud"
token_expires_at = "2030-01-01T00:00:00Z"

[machines.registries."registry.smolmachines.com"]
username = "token"
identity_token = "id_managed_token"
refresh_token = "rt_managed"
expires_at = "2030-06-01T00:00:00Z"
`;
  const cfg = parse(withManaged);
  // Edit a sibling editable field on cloud and on the registry entry.
  cfg.cloud.apiKey = "smk_new";
  cfg.machines.registries[0]!.username = "token2";

  const out = stringify(cfg);
  const reparsed = parseToml(out) as Record<string, any>;

  // Edited fields changed.
  expect(reparsed.cloud.api_key).toBe("smk_new");
  expect(reparsed.machines.registries["registry.smolmachines.com"].username).toBe(
    "token2",
  );
  // Managed fields preserved verbatim.
  expect(reparsed.cloud.refresh_token).toBe("rt_secret_cloud");
  expect(reparsed.cloud.token_expires_at).toBeDefined();
  const entry = reparsed.machines.registries["registry.smolmachines.com"];
  expect(entry.identity_token).toBe("id_managed_token");
  expect(entry.refresh_token).toBe("rt_managed");
  expect(entry.expires_at).toBeDefined();
});

test("unknown top-level tables survive round-trip", () => {
  const withUnknown = `[future_feature]
some_key = "value"

[images.registries."docker.io"]
username = "u"
`;
  const cfg = parse(withUnknown);
  const reparsed = parseToml(stringify(cfg)) as Record<string, any>;
  expect(reparsed.future_feature.some_key).toBe("value");
});

test("empty input yields empty config and empty output", () => {
  const cfg = parse("");
  expect(cfg.images.registries).toEqual([]);
  expect(cfg.machines.registries).toEqual([]);
  expect(cfg.cloud.endpoint).toBeNull();
  expect(stringify(cfg).trim()).toBe("");
});

test("clearing an editable field deletes the key but keeps managed siblings", () => {
  const src = `[images.registries."ghcr.io"]
username = "u"
mirror = "m"
identity_token = "tok"
`;
  const cfg = parse(src);
  cfg.images.registries[0]!.mirror = null;
  const reparsed = parseToml(stringify(cfg)) as Record<string, any>;
  const entry = reparsed.images.registries["ghcr.io"];
  expect(entry.mirror).toBeUndefined();
  expect(entry.username).toBe("u");
  expect(entry.identity_token).toBe("tok");
});

test("equals is dirty-aware on editable fields only", () => {
  const a = parse(FIXTURE);
  const b = cloneConfig(a);
  expect(equals(a, b)).toBe(true);
  b.cloud.apiKey = "changed";
  expect(equals(a, b)).toBe(false);

  // Mutating only a managed raw field should not flip the editable dirty bit.
  const c = cloneConfig(a);
  (c.raw as any).cloud = { ...(c.raw as any).cloud, refresh_token: "x" };
  expect(equals(a, c)).toBe(true);
});

// Silence "unused" if SmolConfig type import is otherwise unreferenced.
const _typecheck: SmolConfig | null = null;
void _typecheck;
