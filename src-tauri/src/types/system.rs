use serde::{Deserialize, Serialize};

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
