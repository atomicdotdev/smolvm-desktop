use serde::{Deserialize, Serialize};

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
pub struct PortMapping {
    pub host: u16,
    pub guest: u16,
    #[serde(default = "default_protocol")]
    pub protocol: String,
}

fn default_protocol() -> String {
    "tcp".to_string()
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
pub struct HealthStatus {
    pub healthy: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub smolvm_version: Option<String>,
    pub smolvm_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmolvmBinary {
    pub path: String,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
    pub prefix_args: Vec<String>,
    pub arg_join: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineInspect {
    pub name: String,
    pub raw: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VolumeMount {
    pub host_path: String,
    pub guest_path: String,
    #[serde(default)]
    pub readonly: bool,
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
    /// Path to a `.smolmachine` pack to import from.
    #[serde(default)]
    pub from_pack: Option<String>,
    /// Path to a smolfile to materialize the machine from.
    #[serde(default)]
    pub smolfile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pack {
    /// Filesystem path to the `.smolmachine` artifact.
    pub path: String,
    /// Display name derived from metadata or the file stem.
    pub name: String,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
    /// Full `pack inspect --json` payload — surfaced verbatim in the UI for
    /// debugging fields we haven't modeled yet.
    #[serde(default)]
    pub raw: serde_json::Value,
}

impl Pack {
    pub fn stub(path: &std::path::Path) -> Self {
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("pack")
            .to_string();
        let size_bytes = std::fs::metadata(path).ok().map(|m| m.len());
        Self {
            path: path.to_string_lossy().to_string(),
            name,
            size_bytes,
            image: None,
            created: None,
            digest: None,
            raw: serde_json::Value::Null,
        }
    }

    pub fn from_inspect(path: &str, raw: serde_json::Value) -> Self {
        let pick = |k: &str| raw.get(k).and_then(|v| v.as_str()).map(|s| s.to_string());
        let name = pick("name").unwrap_or_else(|| {
            std::path::Path::new(path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("pack")
                .to_string()
        });
        let size_bytes = raw
            .get("size")
            .and_then(|v| v.as_u64())
            .or_else(|| std::fs::metadata(path).ok().map(|m| m.len()));
        Self {
            path: path.to_string(),
            name,
            size_bytes,
            image: pick("image"),
            created: pick("created"),
            digest: pick("digest"),
            raw,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreatePackOpts {
    /// Path to a smolfile to build from.
    #[serde(default)]
    pub smolfile: Option<String>,
    /// Name of an existing machine to snapshot into a pack.
    #[serde(default)]
    pub machine: Option<String>,
    /// Output `.smolmachine` path.
    #[serde(default)]
    pub output: Option<String>,
    /// Optional registry-style name embedded in metadata.
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RunPackOpts {
    #[serde(default = "default_true")]
    pub detach: bool,
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub name: Option<String>,
}

fn default_true() -> bool {
    true
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
}
