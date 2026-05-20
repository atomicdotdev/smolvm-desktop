use serde::{Deserialize, Serialize};

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
