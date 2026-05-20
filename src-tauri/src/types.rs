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
    #[serde(default)]
    pub gpu: Option<bool>,
    #[serde(default)]
    pub gpu_vram_mib: Option<u32>,
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
}
