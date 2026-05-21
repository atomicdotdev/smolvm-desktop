//! Commands wrapping `smolvm pack …`.
//!
//! smolvm packs (`.smolmachine` files) are portable artifacts built from a
//! smolfile, OCI image, or stopped VM. These commands shell out to the smolvm
//! CLI; flag spellings were verified against smolvm 0.7.1.

use std::path::PathBuf;

use crate::smolvm::cli;
use crate::types::{CreatePackOpts, Pack, RunPackOpts};

/// Best-effort listing of packs known locally. smolvm has no `pack ls`
/// subcommand and no canonical pack directory (users save to arbitrary
/// `--output` paths). This scans a couple of common locations and stats
/// each `.smolmachine` file. Use a file picker in the UI for packs
/// stored elsewhere.
///
/// `smolvm pack create` produces two files per pack (unless `--single-file`):
/// a Mach-O binary stub at `<name>.smolmachine` and a zstd sidecar at
/// `<name>.smolmachine.smolmachine`. We list only the binary stub — the
/// sidecar is derived when needed.
#[tauri::command]
pub async fn list_packs() -> Result<Vec<Pack>, String> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = home_dir() {
        dirs.push(home.join(".smolvm").join("packs"));
        dirs.push(home.join("Documents").join("smolvm-packs"));
    }

    let mut out: Vec<Pack> = Vec::new();
    for d in &dirs {
        if !d.is_dir() {
            continue;
        }
        let entries = match std::fs::read_dir(d) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && is_pack_binary(&p) {
                out.push(Pack::stub(&p));
            }
        }
    }
    Ok(out)
}

/// True if `path` looks like the binary stub of a pack (ends in `.smolmachine`
/// but not the doubled `.smolmachine.smolmachine` of a sidecar).
pub fn is_pack_binary(path: &std::path::Path) -> bool {
    let name = match path.file_name().and_then(|s| s.to_str()) {
        Some(n) => n,
        None => return false,
    };
    if !name.to_ascii_lowercase().ends_with(".smolmachine") {
        return false;
    }
    // Strip one .smolmachine and see if what remains still ends in .smolmachine
    // — that signals this is the sidecar (foo.smolmachine.smolmachine).
    let stem = &name[..name.len() - ".smolmachine".len()];
    !stem.to_ascii_lowercase().ends_with(".smolmachine")
}

/// Derive the sidecar path from a binary stub path. smolvm's convention
/// is `<binary>.smolmachine` — i.e. the binary's name with `.smolmachine`
/// appended. If the input already points at a sidecar (doubled extension),
/// returns it unchanged.
pub fn sidecar_for(path: &str) -> String {
    let p = std::path::Path::new(path);
    if !is_pack_binary(p) {
        return path.to_string();
    }
    format!("{path}.smolmachine")
}

/// Stat a local pack file. smolvm's `pack inspect` only works on registry
/// references, not local file paths, so this returns metadata derived from
/// the filesystem (size, name from stem) rather than from the pack contents.
#[tauri::command]
pub async fn inspect_pack(path: String) -> Result<Pack, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("pack file not found: {path}"));
    }
    Ok(Pack::stub(p))
}

/// Inspect a registry artifact reference. Maps to `smolvm pack inspect <ref> --json`.
#[tauri::command]
pub async fn inspect_registry_pack(reference: String) -> Result<Pack, String> {
    let json = cli::run_checked(&["pack", "inspect", &reference, "--json"]).await?;
    let raw: serde_json::Value =
        serde_json::from_str(json.trim()).map_err(|e| format!("parse pack inspect json: {e}"))?;
    Ok(Pack::from_inspect(&reference, raw))
}

#[tauri::command]
pub async fn create_pack(opts: CreatePackOpts) -> Result<String, String> {
    let mut args: Vec<String> = vec!["pack".into(), "create".into()];

    if let Some(smolfile) = opts.smolfile.as_ref().and_then(trim_opt) {
        args.push("--smolfile".into());
        args.push(smolfile);
    }
    if let Some(from_vm) = opts.from_vm.as_ref().and_then(trim_opt) {
        args.push("--from-vm".into());
        args.push(from_vm);
    }
    if let Some(image) = opts.image.as_ref().and_then(trim_opt) {
        args.push("--image".into());
        args.push(image);
    }
    // --output is required by smolvm — let it error if missing rather than
    // guessing a default that surprises the user.
    if let Some(output) = opts.output.as_ref().and_then(trim_opt) {
        args.push("--output".into());
        args.push(output);
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli::run_checked(&arg_refs).await?;
    Ok(out.trim().to_string())
}

/// Run a packed sidecar. smolvm's `pack run` runs in the foreground and
/// blocks until the workload exits — there is no detach flag. This wrapper
/// is best for short non-interactive workloads or `--info` previews.
///
/// `path` may be either the binary stub or the sidecar; we derive the
/// correct sidecar path automatically.
#[tauri::command]
pub async fn run_pack(path: String, opts: RunPackOpts) -> Result<String, String> {
    let sidecar = sidecar_for(&path);
    let mut args: Vec<String> = vec!["pack".into(), "run".into(), "--sidecar".into(), sidecar];
    if opts.network {
        args.push("--net".into());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli::run_checked(&arg_refs).await?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn push_pack(path: String, registry_ref: String) -> Result<String, String> {
    let out = cli::run_checked(&["pack", "push", "-f", &path, &registry_ref]).await?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn pull_pack(registry_ref: String, output: Option<String>) -> Result<String, String> {
    let mut args: Vec<String> = vec!["pack".into(), "pull".into()];
    if let Some(o) = output.as_ref().and_then(trim_opt) {
        args.push("-o".into());
        args.push(o);
    }
    args.push(registry_ref);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli::run_checked(&arg_refs).await?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn prune_packs(dry_run: bool, all: bool, keep: Option<u32>) -> Result<String, String> {
    let mut args: Vec<String> = vec!["pack".into(), "prune".into()];
    if dry_run {
        args.push("--dry-run".into());
    }
    if all {
        args.push("--all".into());
    } else if let Some(k) = keep {
        args.push("--keep".into());
        args.push(k.to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli::run_checked(&arg_refs).await?;
    Ok(out.trim().to_string())
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn trim_opt(s: &String) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}
