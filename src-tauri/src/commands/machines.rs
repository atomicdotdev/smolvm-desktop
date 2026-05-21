use crate::commands::exec;
use crate::smolvm::{cli, parser, smolfile_gen};
use crate::types::{
    HealthSpec, Machine, MachineConfig, MachineInspect, MachinePatch, MachineStatus, RestartSpec,
    RunConfig,
};

/// RAII guard around a temp Smolfile so the file is cleaned up even if the
/// `cli::run_checked` call panics or returns early via `?`.
struct TempSmolfile {
    path: std::path::PathBuf,
}

impl TempSmolfile {
    fn write(contents: &str) -> Result<Self, String> {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        // Best-effort uniqueness: nanos + pid is plenty for sequential
        // create calls in this process; the global CLI lock serializes
        // smolvm invocations anyway.
        let name = format!("smolvm-desktop-policy-{}-{}.smolfile", std::process::id(), nanos);
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, contents)
            .map_err(|e| format!("failed to write temp smolfile {}: {e}", path.display()))?;
        Ok(Self { path })
    }

    fn path_str(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }
}

impl Drop for TempSmolfile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// If either `restart` or `health` is set, render the policy-only Smolfile
/// to a tempfile and append `--smolfile <path>` to `args`. The returned
/// guard MUST be held for the lifetime of the CLI call so the file isn't
/// deleted before smolvm reads it.
fn maybe_append_policy_smolfile(
    args: &mut Vec<String>,
    restart: Option<&RestartSpec>,
    health: Option<&HealthSpec>,
) -> Result<Option<TempSmolfile>, String> {
    let Some(toml) = smolfile_gen::to_policy_smolfile(restart, health) else {
        return Ok(None);
    };
    let guard = TempSmolfile::write(&toml)?;
    args.push("--smolfile".into());
    args.push(guard.path_str());
    Ok(Some(guard))
}

#[tauri::command]
pub async fn list_machines() -> Result<Vec<Machine>, String> {
    let json = cli::run_checked(&["machine", "ls", "-v", "--json"]).await?;
    let mut machines = parser::parse_machines(&json)?;

    // JSON doesn't expose env vars or mount details; fall back to the
    // text `ls -v` form and merge in the extras.
    if !machines.is_empty() {
        if let Ok(text) = cli::run_checked(&["machine", "ls", "-v"]).await {
            let extras = parser::parse_machine_extras(&text);
            for m in machines.iter_mut() {
                if let Some(e) = extras.get(&m.name) {
                    m.env_count = e.env_count;
                    m.mounts = e.mounts.clone();
                }
            }
        }
    }

    Ok(machines)
}

#[tauri::command]
pub async fn start_machine(name: String) -> Result<(), String> {
    cli::run_checked(&["machine", "start", "-n", &name]).await?;
    Ok(())
}

#[tauri::command]
pub async fn stop_machine(name: String) -> Result<(), String> {
    exec::kill_sessions_for(&name);
    cli::run_checked(&["machine", "stop", "-n", &name]).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_machine(name: String) -> Result<(), String> {
    exec::kill_sessions_for(&name);
    cli::run_checked(&["machine", "delete", "-f", &name]).await?;
    Ok(())
}

#[tauri::command]
pub async fn inspect_machine(name: String) -> Result<MachineInspect, String> {
    let out = cli::run_checked(&["machine", "ls", "-v", "--json"]).await?;
    let raw: serde_json::Value =
        serde_json::from_str(out.trim()).map_err(|e| format!("parse inspect json: {e}"))?;
    let arr = raw
        .as_array()
        .ok_or_else(|| "expected JSON array".to_string())?;
    let entry = arr
        .iter()
        .find(|v| v.get("name").and_then(|n| n.as_str()) == Some(name.as_str()))
        .ok_or_else(|| format!("machine `{name}` not found"))?;
    Ok(MachineInspect {
        name: name.clone(),
        raw: entry.clone(),
    })
}

#[tauri::command]
pub async fn create_machine(config: MachineConfig) -> Result<Machine, String> {
    let mut args: Vec<String> = vec!["machine".into(), "create".into()];

    // Import sources take precedence over `--image`. smolvm v0.5.13 added
    // `--from <path>` for packed `.smolmachine` artifacts (PR #135) and
    // `--smolfile <path>` to materialize from a smolfile.
    // TODO: verify flag spellings against the installed smolvm version.
    let from_pack = config.from_pack.as_ref().and_then(trim_to_some);
    let smolfile = config.smolfile.as_ref().and_then(trim_to_some);
    if let Some(from) = from_pack {
        // `pack create` produces a binary stub + sidecar pair; smolvm's
        // `--from` wants the sidecar. Auto-resolve if the user picked the
        // binary path (the more obvious file in the picker).
        args.push("--from".into());
        args.push(crate::commands::pack::sidecar_for(&from));
    } else if let Some(sf) = smolfile {
        args.push("--smolfile".into());
        args.push(sf);
    } else if let Some(image) = &config.image {
        args.push("--image".into());
        args.push(image.clone());
    }
    if config.network {
        args.push("--net".into());
    }
    if let Some(cpus) = config.cpus {
        args.push("--cpus".into());
        args.push(cpus.to_string());
    }
    if let Some(mem) = config.memory_mb {
        args.push("--mem".into());
        args.push(mem.to_string());
    }
    if config.ssh_agent {
        args.push("--ssh-agent".into());
    }
    for env in &config.env {
        if let Some((k, v)) = normalize_env(&env.key, &env.value) {
            args.push("--env".into());
            args.push(format!("{k}={v}"));
        }
    }
    for vol in &config.volumes {
        args.push("--volume".into());
        args.push(format_volume(vol));
    }
    for p in &config.ports {
        args.push("--port".into());
        args.push(format!("{}:{}", p.host, p.guest));
    }
    for host in &config.allow_hosts {
        args.push("--allow-host".into());
        args.push(host.clone());
    }
    for cmd in &config.init_commands {
        let trimmed = cmd.trim();
        if !trimmed.is_empty() {
            args.push("--init".into());
            args.push(trimmed.to_string());
        }
    }
    if let Some(workdir) = config.workdir.as_ref().and_then(trim_to_some) {
        args.push("--workdir".into());
        args.push(workdir);
    }
    if config.gpu.unwrap_or(false) {
        args.push("--gpu".into());
    }
    if let Some(vram) = config.gpu_vram_mib {
        args.push("--gpu-vram".into());
        args.push(vram.to_string());
    }
    // Policy authored in the dialog → generate a tiny policy-only Smolfile
    // and append `--smolfile <tempfile>`. Skip when the user already picked
    // a Smolfile source: their file is authoritative for restart/health
    // anyway, and stacking two `--smolfile` flags has undefined behavior.
    let _policy_guard = if config.smolfile.as_ref().and_then(trim_to_some).is_none() {
        maybe_append_policy_smolfile(
            &mut args,
            config.restart.as_ref(),
            config.health.as_ref(),
        )?
    } else {
        None
    };

    // Positional NAME last, optional
    if let Some(name) = &config.name {
        args.push(name.clone());
    }

    // Snapshot existing machine names before the call. smolvm auto-generates
    // a name (e.g. `vm-7095dce0`) when none is passed, and `--from <pack>`
    // may also override the user-supplied name with one embedded in the pack
    // manifest. Diffing before/after is the only reliable way to identify
    // the newly created machine.
    let before: std::collections::HashSet<String> = list_machines()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|m| m.name)
        .collect();

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    cli::run_checked(&arg_refs).await?;

    let after = list_machines().await?;
    // Prefer the user-supplied name if it actually shows up; fall back to
    // any name that wasn't in `before`.
    if let Some(name) = config.name.as_ref().and_then(trim_to_some) {
        if let Some(m) = after.iter().find(|m| m.name == name) {
            return Ok(m.clone());
        }
    }
    let new_machine = after
        .iter()
        .find(|m| !before.contains(&m.name))
        .cloned()
        .ok_or_else(|| "machine created but could not be identified afterward".to_string())?;
    Ok(new_machine)
}

#[tauri::command]
pub async fn update_machine(name: String, patch: MachinePatch) -> Result<Machine, String> {
    // Pre-check: smolvm requires the VM to be stopped. Surface a clear
    // message instead of letting the upstream error leak through.
    let machines = list_machines().await?;
    let current = machines
        .iter()
        .find(|m| m.name == name)
        .ok_or_else(|| format!("machine `{name}` not found"))?;
    if matches!(
        current.status,
        MachineStatus::Running | MachineStatus::Starting
    ) {
        return Err(format!(
            "machine `{name}` is running — stop it before editing"
        ));
    }

    let args = build_update_args(&name, &patch);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    cli::run_checked(&arg_refs).await?;

    refetch_machine(&name).await
}

/// Build the `smolvm machine update <NAME>` argv. Only fields explicitly
/// set in the patch are emitted; everything else is left for upstream to
/// preserve.
fn build_update_args(name: &str, patch: &MachinePatch) -> Vec<String> {
    let mut args: Vec<String> = vec!["machine".into(), "update".into()];

    if let Some(cpus) = patch.cpus {
        args.push("--cpus".into());
        args.push(cpus.to_string());
    }
    if let Some(mem) = patch.memory_mb {
        args.push("--mem".into());
        args.push(mem.to_string());
    }
    match patch.network {
        Some(true) => args.push("--net".into()),
        Some(false) => args.push("--no-net".into()),
        None => {}
    }
    if let Some(workdir) = patch.workdir.as_ref() {
        let t = workdir.trim();
        if !t.is_empty() {
            args.push("--workdir".into());
            args.push(t.to_string());
        }
    }
    match patch.gpu {
        Some(true) => args.push("--gpu".into()),
        Some(false) => args.push("--no-gpu".into()),
        None => {}
    }
    if let Some(vram) = patch.gpu_vram_mib {
        args.push("--gpu-vram".into());
        args.push(vram.to_string());
    }
    if let Some(storage) = patch.storage_gib {
        args.push("--storage".into());
        args.push(storage.to_string());
    }
    if let Some(overlay) = patch.overlay_gib {
        args.push("--overlay".into());
        args.push(overlay.to_string());
    }

    for vol in &patch.add_volumes {
        args.push("--volume".into());
        args.push(format_volume(vol));
    }
    for v in &patch.remove_volumes {
        let t = v.trim();
        if !t.is_empty() {
            args.push("--remove-volume".into());
            args.push(t.to_string());
        }
    }
    for p in &patch.add_ports {
        args.push("--port".into());
        args.push(format!("{}:{}", p.host, p.guest));
    }
    for p in &patch.remove_ports {
        let t = p.trim();
        if !t.is_empty() {
            args.push("--remove-port".into());
            args.push(t.to_string());
        }
    }
    for env in &patch.add_env {
        if let Some((k, v)) = normalize_env(&env.key, &env.value) {
            args.push("--env".into());
            args.push(format!("{k}={v}"));
        }
    }
    for k in &patch.remove_env {
        let key = k.trim().to_uppercase();
        if !key.is_empty() {
            args.push("--remove-env".into());
            args.push(key);
        }
    }

    args.push(name.to_string());
    args
}

#[tauri::command]
pub async fn run_machine(config: RunConfig) -> Result<String, String> {
    // `machine run` is ephemeral; `-d` detaches so the VM outlives this subprocess.
    let mut args: Vec<String> = vec!["machine".into(), "run".into(), "-d".into()];

    args.push("--image".into());
    args.push(config.image.clone());

    if config.network {
        args.push("--net".into());
    }
    if config.interactive {
        args.push("-i".into());
        args.push("-t".into());
    }
    if let Some(cpus) = config.cpus {
        args.push("--cpus".into());
        args.push(cpus.to_string());
    }
    if let Some(mem) = config.memory_mb {
        args.push("--mem".into());
        args.push(mem.to_string());
    }
    if config.ssh_agent {
        args.push("--ssh-agent".into());
    }
    for env in &config.env {
        if let Some((k, v)) = normalize_env(&env.key, &env.value) {
            args.push("--env".into());
            args.push(format!("{k}={v}"));
        }
    }
    for vol in &config.volumes {
        args.push("--volume".into());
        args.push(format_volume(vol));
    }
    for p in &config.ports {
        args.push("--port".into());
        args.push(format!("{}:{}", p.host, p.guest));
    }
    for host in &config.allow_hosts {
        let t = host.trim();
        if !t.is_empty() {
            args.push("--allow-host".into());
            args.push(t.to_string());
        }
    }
    if let Some(workdir) = config.workdir.as_ref().and_then(trim_to_some) {
        args.push("--workdir".into());
        args.push(workdir);
    }
    if config.gpu.unwrap_or(false) {
        args.push("--gpu".into());
    }
    if let Some(vram) = config.gpu_vram_mib {
        args.push("--gpu-vram".into());
        args.push(vram.to_string());
    }
    // Policy authored in the dialog (ephemeral path). Same mechanism as
    // `create_machine`: write a tiny policy-only Smolfile, append
    // `--smolfile`. `pack run` / `machine run -d` accept it. Held alive
    // until after `run_checked` returns; dropped via `_policy_guard`.
    let _policy_guard = maybe_append_policy_smolfile(
        &mut args,
        config.restart.as_ref(),
        config.health.as_ref(),
    )?;

    if let Some(cmd) = &config.command {
        if !cmd.trim().is_empty() {
            args.push("--".into());
            for part in cmd.split_whitespace() {
                args.push(part.to_string());
            }
        }
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli::run_checked(&arg_refs).await?;
    Ok(out.trim().to_string())
}

async fn refetch_machine(name: &str) -> Result<Machine, String> {
    let all = list_machines().await?;
    all.into_iter()
        .find(|m| m.name == name)
        .ok_or_else(|| format!("machine `{name}` not found after create"))
}

fn trim_to_some(s: &String) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Upper-cases and validates an env var name. Returns `Some((KEY, value))` if
/// the key is a POSIX-compliant identifier (starts with letter/underscore,
/// followed by letters/digits/underscores), else `None`.
fn normalize_env(key: &str, value: &str) -> Option<(String, String)> {
    let k = key.trim().to_uppercase();
    if k.is_empty() {
        return None;
    }
    let mut chars = k.chars();
    let first = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    Some((k, value.to_string()))
}

fn format_volume(vol: &crate::types::VolumeMount) -> String {
    let base = format!("{}:{}", vol.host_path, vol.guest_path);
    if vol.readonly {
        format!("{base}:ro")
    } else {
        base
    }
}
