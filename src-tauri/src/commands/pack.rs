//! Commands wrapping `smolvm pack …`.
//!
//! smolvm packs (`.smolmachine` files) are portable artifacts built from a
//! smolfile or a running machine. These commands shell out to the smolvm CLI
//! and return parsed metadata.

use std::path::PathBuf;

use crate::smolvm::cli;
use crate::types::{CreatePackOpts, Pack, RunPackOpts};

/// Best-effort listing of packs known locally.
///
/// smolvm's CLI does not (yet) ship a `pack ls` subcommand; instead we look
/// for `.smolmachine` files inside a conventional cache directory under
/// `~/.smolvm/packs`. If the directory doesn't exist we return an empty list
/// — callers fall back to a file picker.
// TODO: verify pack list location / replace with `pack ls --json` once smolvm exposes it.
#[tauri::command]
pub async fn list_packs() -> Result<Vec<Pack>, String> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs_home() {
        dirs.push(home.join(".smolvm").join("packs"));
        dirs.push(home.join(".smolvm").join("cache").join("packs"));
    }

    let mut paths: Vec<PathBuf> = Vec::new();
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
            if p.is_file()
                && p.extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.eq_ignore_ascii_case("smolmachine"))
                    .unwrap_or(false)
            {
                paths.push(p);
            }
        }
    }

    let mut out: Vec<Pack> = Vec::new();
    for p in paths {
        match inspect_pack_inner(&p).await {
            Ok(pack) => out.push(pack),
            Err(_) => out.push(Pack::stub(&p)),
        }
    }
    Ok(out)
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[tauri::command]
pub async fn inspect_pack(path: String) -> Result<Pack, String> {
    inspect_pack_inner(std::path::Path::new(&path)).await
}

async fn inspect_pack_inner(path: &std::path::Path) -> Result<Pack, String> {
    let p = path.to_string_lossy().to_string();
    // TODO: verify flag spelling — assuming `pack inspect <path> --json`.
    let json = cli::run_checked(&["pack", "inspect", &p, "--json"]).await?;
    let raw: serde_json::Value =
        serde_json::from_str(json.trim()).map_err(|e| format!("parse pack inspect json: {e}"))?;
    Ok(Pack::from_inspect(&p, raw))
}

#[tauri::command]
pub async fn create_pack(opts: CreatePackOpts) -> Result<String, String> {
    let mut args: Vec<String> = vec!["pack".into(), "create".into()];

    // TODO: verify flag spellings. We assume:
    //   --smolfile <path>   build from a smolfile
    //   --machine <name>    snapshot a running/created machine
    //   --output <path>     destination .smolmachine
    //   --name <ref>        optional registry-style name embedded in metadata
    if let Some(smolfile) = opts.smolfile.as_ref().and_then(trim_opt) {
        args.push("--smolfile".into());
        args.push(smolfile);
    }
    if let Some(machine) = opts.machine.as_ref().and_then(trim_opt) {
        args.push("--machine".into());
        args.push(machine);
    }
    if let Some(output) = opts.output.as_ref().and_then(trim_opt) {
        args.push("--output".into());
        args.push(output);
    }
    if let Some(name) = opts.name.as_ref().and_then(trim_opt) {
        args.push("--name".into());
        args.push(name);
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli::run_checked(&arg_refs).await?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn run_pack(path: String, opts: RunPackOpts) -> Result<String, String> {
    let mut args: Vec<String> = vec!["pack".into(), "run".into(), path];

    // smolvm's `machine run` uses `-d` to detach; we assume `pack run` mirrors it.
    // TODO: verify `pack run` flag set against live smolvm.
    if opts.detach {
        args.push("-d".into());
    }
    if opts.network {
        args.push("--net".into());
    }
    if let Some(name) = opts.name.as_ref().and_then(trim_opt) {
        args.push("--name".into());
        args.push(name);
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli::run_checked(&arg_refs).await?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn push_pack(path: String, registry_ref: String) -> Result<String, String> {
    let out = cli::run_checked(&["pack", "push", &path, &registry_ref]).await?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn pull_pack(registry_ref: String) -> Result<String, String> {
    let out = cli::run_checked(&["pack", "pull", &registry_ref]).await?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn prune_packs(dry_run: bool, all: bool) -> Result<String, String> {
    let mut args: Vec<String> = vec!["pack".into(), "prune".into()];
    // TODO: verify flag spellings — assuming `--dry-run` and `--all`.
    if dry_run {
        args.push("--dry-run".into());
    }
    if all {
        args.push("--all".into());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli::run_checked(&arg_refs).await?;
    Ok(out.trim().to_string())
}

fn trim_opt(s: &String) -> Option<String> {
    let t = s.trim();
    if t.is_empty() { None } else { Some(t.to_string()) }
}
