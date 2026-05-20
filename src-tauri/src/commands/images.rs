//! Cached image layers per machine.
//!
//! smolvm 0.6.4 introduced `machine images --name <N> [--json]` and
//! `machine prune --name <N> [--dry-run] [--all]` (PRs #266, #243). This module
//! shells out to those subcommands.
//!
//! Since the exact JSON shape isn't documented in this repo, we keep the
//! decoding permissive: `ImageEntry` holds the raw JSON object plus a few
//! best-effort named fields. The frontend renders whatever it can find. Tighten
//! when the live CLI shape is confirmed.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::smolvm::cli;

/// One cached layer (or image record) for a given machine.
///
/// We capture a few likely fields by name so the UI can render a nice table
/// even before the JSON shape is fully nailed down. Anything we don't
/// recognize lives in `raw` and can be rendered as a fallback.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ImageEntry {
    /// Layer digest / id (e.g. "sha256:abc…"). Looked up under common keys.
    #[serde(default)]
    pub digest: Option<String>,
    /// Image reference this layer belongs to, if reported.
    #[serde(default)]
    pub reference: Option<String>,
    /// Layer size in bytes, if reported.
    #[serde(default)]
    pub size_bytes: Option<u64>,
    /// Created / pulled timestamp (ISO 8601 string, if reported).
    #[serde(default)]
    pub created: Option<String>,
    /// Whether the layer is currently in use by the machine.
    #[serde(default)]
    pub in_use: Option<bool>,
    /// Raw JSON object so the UI can fall back to displaying every field.
    #[serde(default)]
    pub raw: Value,
}

/// Result of `machine prune`. We keep `output` as the raw CLI text so the UI
/// can show whatever smolvm prints (it currently emits a human-readable
/// summary), and best-effort parse a couple of numeric fields out of any
/// JSON-ish line we find.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PruneResult {
    /// The full stdout from `machine prune`, suitable for display.
    pub output: String,
    /// True if `--dry-run` was passed.
    pub dry_run: bool,
    /// True if `--all` was passed.
    pub all: bool,
    /// Number of layers reported as removed/removable, if parsable.
    #[serde(default)]
    pub removed_count: Option<u64>,
    /// Total reclaimed (or reclaimable, in dry-run) bytes, if parsable.
    #[serde(default)]
    pub reclaimed_bytes: Option<u64>,
}

#[tauri::command]
pub async fn list_machine_images(name: String) -> Result<Vec<ImageEntry>, String> {
    let out = cli::run_checked(&["machine", "images", "--name", &name, "--json"]).await?;
    parse_image_entries(&out)
}

#[tauri::command]
pub async fn prune_machine_images(
    name: String,
    all: bool,
    dry_run: bool,
) -> Result<PruneResult, String> {
    let mut args: Vec<&str> = vec!["machine", "prune", "--name", &name];
    if dry_run {
        args.push("--dry-run");
    }
    if all {
        args.push("--all");
    }
    let out = cli::run_checked(&args).await?;
    Ok(parse_prune_output(&out, dry_run, all))
}

fn parse_image_entries(raw: &str) -> Result<Vec<ImageEntry>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let value: Value =
        serde_json::from_str(trimmed).map_err(|e| format!("parse images json: {e}"))?;

    // Accept either a top-level array, or an object with `layers` / `images` /
    // `entries` arrays (whichever smolvm ends up using).
    let arr = if let Some(a) = value.as_array() {
        a.clone()
    } else if let Some(obj) = value.as_object() {
        ["layers", "images", "entries", "items"]
            .iter()
            .find_map(|k| obj.get(*k).and_then(Value::as_array))
            .cloned()
            .unwrap_or_else(|| vec![value.clone()])
    } else {
        return Err("expected JSON array or object from `machine images --json`".to_string());
    };

    Ok(arr.iter().map(entry_from_value).collect())
}

fn entry_from_value(v: &Value) -> ImageEntry {
    let obj = match v.as_object() {
        Some(o) => o,
        None => {
            return ImageEntry {
                raw: v.clone(),
                ..Default::default()
            };
        }
    };

    let digest = string_field(obj, &["digest", "id", "sha", "sha256", "hash"]);
    let reference = string_field(obj, &["reference", "ref", "image", "image_ref", "imageRef"]);
    let size_bytes = u64_field(obj, &["size", "size_bytes", "sizeBytes", "bytes"]);
    let created = string_field(obj, &["created", "created_at", "createdAt", "pulled_at"]);
    let in_use = obj
        .get("in_use")
        .or_else(|| obj.get("inUse"))
        .or_else(|| obj.get("used"))
        .and_then(Value::as_bool);

    ImageEntry {
        digest,
        reference,
        size_bytes,
        created,
        in_use,
        raw: v.clone(),
    }
}

fn string_field(
    obj: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    for k in keys {
        if let Some(s) = obj.get(*k).and_then(Value::as_str) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn u64_field(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<u64> {
    for k in keys {
        if let Some(n) = obj.get(*k).and_then(Value::as_u64) {
            return Some(n);
        }
        // Some CLIs emit size as a stringified number.
        if let Some(s) = obj.get(*k).and_then(Value::as_str) {
            if let Ok(n) = s.parse::<u64>() {
                return Some(n);
            }
        }
    }
    None
}

/// Best-effort scrape of numeric summary out of `machine prune` text output.
/// Looks for patterns like "Reclaimed 1.2 GB" or "Removed N layers" — and
/// also tries to parse a JSON object if smolvm happens to emit one.
fn parse_prune_output(raw: &str, dry_run: bool, all: bool) -> PruneResult {
    let mut result = PruneResult {
        output: raw.to_string(),
        dry_run,
        all,
        ..Default::default()
    };

    // If smolvm gives us a JSON object, prefer that.
    if let Ok(v) = serde_json::from_str::<Value>(raw.trim()) {
        if let Some(obj) = v.as_object() {
            result.removed_count = u64_field(
                obj,
                &["removed", "removed_count", "removedCount", "count"],
            );
            result.reclaimed_bytes = u64_field(
                obj,
                &[
                    "reclaimed",
                    "reclaimed_bytes",
                    "reclaimedBytes",
                    "freed",
                    "freed_bytes",
                ],
            );
        }
    }

    result
}
