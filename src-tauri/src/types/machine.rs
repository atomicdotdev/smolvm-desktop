use super::common::{EnvVar, PortMapping, VolumeMount};
use serde::{Deserialize, Serialize};

/// Restart policy persisted into a VM's `[restart]` Smolfile section.
/// Mirrors smolvm's `RestartPolicy` enum (see `src/cli/smolfile.rs`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RestartPolicy {
    Never,
    Always,
    OnFailure,
    UnlessStopped,
}

impl RestartPolicy {
    pub fn as_smolfile_str(self) -> &'static str {
        match self {
            RestartPolicy::Never => "never",
            RestartPolicy::Always => "always",
            RestartPolicy::OnFailure => "on-failure",
            RestartPolicy::UnlessStopped => "unless-stopped",
        }
    }
}

/// `[restart]` section of the Smolfile we emit at create-time. Only fields
/// the user explicitly set are written; missing fields fall back to smolvm's
/// defaults.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestartSpec {
    pub policy: RestartPolicy,
    #[serde(default)]
    pub max_retries: Option<u32>,
    #[serde(default)]
    pub max_backoff_secs: Option<u32>,
}

/// `[health]` section of the Smolfile we emit at create-time.
/// `exec` is a free-form argv (usually `["sh", "-c", "<cmd>"]` wrapped by
/// the UI). Durations are stored as integer seconds and serialized as
/// `"<N>s"` strings which `parse_duration_secs` accepts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthSpec {
    pub exec: Vec<String>,
    #[serde(default)]
    pub interval_secs: Option<u32>,
    #[serde(default)]
    pub timeout_secs: Option<u32>,
    #[serde(default)]
    pub retries: Option<u32>,
    #[serde(default)]
    pub startup_grace_secs: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MachineStatus {
    Running,
    Stopped,
    Starting,
    Created,
    Exited,
    Unreachable,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Machine {
    pub name: String,
    pub status: MachineStatus,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub ports: Vec<PortMapping>,
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub memory_mb: Option<u32>,
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub pid: Option<u32>,
    /// Number of env vars configured. Sourced from `machine ls -v` text
    /// output because the JSON form omits them.
    #[serde(default)]
    pub env_count: u32,
    /// Volume mounts. Parsed from `machine ls -v` (text) since JSON output
    /// only exposes a count, not the actual paths.
    #[serde(default)]
    pub mounts: Vec<VolumeMount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineInspect {
    pub name: String,
    pub raw: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineConfig {
    pub name: Option<String>,
    pub image: Option<String>,
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub memory_mb: Option<u32>,
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub ssh_agent: bool,
    #[serde(default)]
    pub volumes: Vec<VolumeMount>,
    #[serde(default)]
    pub ports: Vec<PortMapping>,
    #[serde(default)]
    pub env: Vec<EnvVar>,
    #[serde(default)]
    pub allow_hosts: Vec<String>,
    #[serde(default)]
    pub init_commands: Vec<String>,
    #[serde(default)]
    pub workdir: Option<String>,
    #[serde(default)]
    pub gpu: Option<bool>,
    #[serde(default)]
    pub gpu_vram_mib: Option<u32>,
    /// Path to a `.smolmachine` pack to import from.
    #[serde(default)]
    pub from_pack: Option<String>,
    /// Path to a smolfile to materialize the machine from.
    #[serde(default)]
    pub smolfile: Option<String>,
    /// Optional restart policy authored at create time. When set, the
    /// backend generates a tiny Smolfile containing only this section and
    /// appends `--smolfile <tempfile>` to the create argv.
    #[serde(default)]
    pub restart: Option<RestartSpec>,
    /// Optional health-check spec authored at create time. Composes with
    /// `restart` into the same generated Smolfile.
    #[serde(default)]
    pub health: Option<HealthSpec>,
}

/// Patch sent to `machine update`. Only fields with `Some(_)` (or non-empty
/// removal vectors) are translated into CLI flags — the rest are left
/// untouched on the existing machine config.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MachinePatch {
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub memory_mb: Option<u32>,
    #[serde(default)]
    pub network: Option<bool>,
    #[serde(default)]
    pub workdir: Option<String>,
    #[serde(default)]
    pub gpu: Option<bool>,
    #[serde(default)]
    pub gpu_vram_mib: Option<u32>,
    #[serde(default)]
    pub storage_gib: Option<u32>,
    #[serde(default)]
    pub overlay_gib: Option<u32>,
    /// Volumes to add (additive).
    #[serde(default)]
    pub add_volumes: Vec<VolumeMount>,
    /// Volume specs to remove (matched verbatim by smolvm).
    #[serde(default)]
    pub remove_volumes: Vec<String>,
    /// Ports to add (additive).
    #[serde(default)]
    pub add_ports: Vec<PortMapping>,
    /// Port specs to remove (e.g. `8080:80`).
    #[serde(default)]
    pub remove_ports: Vec<String>,
    /// Env vars to add or overwrite.
    #[serde(default)]
    pub add_env: Vec<EnvVar>,
    /// Env var keys to remove.
    #[serde(default)]
    pub remove_env: Vec<String>,
}

/// Per-session overrides for `smolvm machine monitor`. Each field is optional;
/// empty means "use the persisted policy as-is". Sent verbatim from the UI to
/// the supervisor spawn.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MonitorOverrides {
    /// `--restart` flag: never | always | on-failure | unless-stopped.
    #[serde(default)]
    pub restart: Option<String>,
    /// `--health-cmd` flag: a single shell-style command string. Wrapped by
    /// the user; we pass through verbatim.
    #[serde(default)]
    pub health_cmd: Option<String>,
    /// `--health-timeout` flag, in seconds.
    #[serde(default)]
    pub health_timeout_secs: Option<u32>,
    /// `--interval` flag, in seconds.
    #[serde(default)]
    pub interval_secs: Option<u32>,
    /// `--health-retries` flag.
    #[serde(default)]
    pub health_retries: Option<u32>,
}

/// Snapshot of a running supervisor returned by `supervise_status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupervisorStatus {
    pub machine: String,
    pub overrides: MonitorOverrides,
    /// Unix-millis since epoch when the supervisor started.
    pub started_at_ms: u64,
    /// `Some(code)` iff the child has exited; `None` while running.
    pub exit_code: Option<i32>,
    /// Snapshot of the log ring buffer (oldest → newest), so a freshly-mounted
    /// MonitorTab can backfill instead of starting blank.
    pub log_tail: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunConfig {
    pub image: String,
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub memory_mb: Option<u32>,
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub interactive: bool,
    #[serde(default)]
    pub ssh_agent: bool,
    #[serde(default)]
    pub volumes: Vec<VolumeMount>,
    #[serde(default)]
    pub ports: Vec<PortMapping>,
    #[serde(default)]
    pub env: Vec<EnvVar>,
    #[serde(default)]
    pub allow_hosts: Vec<String>,
    #[serde(default)]
    pub workdir: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub gpu: Option<bool>,
    #[serde(default)]
    pub gpu_vram_mib: Option<u32>,
    /// Optional restart policy. Persisted into the ephemeral VM's record
    /// via a generated `--smolfile` (same mechanism as `create_machine`).
    #[serde(default)]
    pub restart: Option<RestartSpec>,
    /// Optional health-check spec.
    #[serde(default)]
    pub health: Option<HealthSpec>,
}
