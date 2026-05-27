//! Parse `smolvm machine ls --json` output into our [`Machine`] type.
//!
//! The CLI emits a JSON array whose shape is not fully stable; we read what we
//! can and ignore unknown fields. A minimum of `name` + `status` is required.

use crate::types::{Machine, MachineStatus, PortMapping, VolumeMount};
use serde_json::Value;

pub fn parse_machines(raw: &str) -> Result<Vec<Machine>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let value: Value = serde_json::from_str(trimmed).map_err(|e| format!("parse ls json: {e}"))?;
    let arr = value
        .as_array()
        .ok_or_else(|| "expected JSON array from `machine ls --json`".to_string())?;

    Ok(arr.iter().filter_map(machine_from_value).collect())
}

fn machine_from_value(v: &Value) -> Option<Machine> {
    let obj = v.as_object()?;
    let name = obj
        .get("name")
        .and_then(Value::as_str)
        .map(ToString::to_string)?;

    let status = obj
        .get("status")
        .or_else(|| obj.get("state"))
        .and_then(Value::as_str)
        .map(parse_status)
        .unwrap_or(MachineStatus::Unknown);

    let image = string_field(obj, &["image", "image_ref", "imageRef"]);
    let created = string_field(obj, &["created", "created_at", "createdAt"]);
    let cpus = obj.get("cpus").and_then(Value::as_u64).map(|n| n as u32);
    let memory_mb = obj
        .get("memory_mib")
        .or_else(|| obj.get("memory_mb"))
        .or_else(|| obj.get("memory"))
        .or_else(|| obj.get("mem"))
        .and_then(Value::as_u64)
        .map(|n| n as u32);
    let network = obj
        .get("network")
        .or_else(|| obj.get("net"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let pid = obj.get("pid").and_then(Value::as_u64).map(|n| n as u32);
    // `ports` may be a detailed array or just a count (integer).
    // Verbose output sometimes exposes detail under `port_mappings`.
    let ports: Vec<PortMapping> = obj
        .get("ports")
        .or_else(|| obj.get("port_mappings"))
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(port_from_value).collect())
        .unwrap_or_default();

    // Persisted restart/health policy (smolvm >= 0.8.0). Absent on older
    // versions, in which case these stay None and the UI hides the panel.
    let restart_policy = string_field(obj, &["restart_policy"]);
    let restart_max_retries = obj
        .get("restart_max_retries")
        .and_then(Value::as_u64)
        .map(|n| n as u32);
    let restart_count = obj
        .get("restart_count")
        .and_then(Value::as_u64)
        .map(|n| n as u32);
    let health_cmd = string_field(obj, &["health_cmd"]);
    let health_interval_secs = obj.get("health_interval_secs").and_then(Value::as_u64);
    let health_timeout_secs = obj.get("health_timeout_secs").and_then(Value::as_u64);
    let health_retries = obj
        .get("health_retries")
        .and_then(Value::as_u64)
        .map(|n| n as u32);
    let health_startup_grace_secs = obj
        .get("health_startup_grace_secs")
        .and_then(Value::as_u64);

    Some(Machine {
        name,
        status,
        image,
        created,
        ports,
        cpus,
        memory_mb,
        network,
        pid,
        env_count: 0,
        mounts: Vec::new(),
        restart_policy,
        restart_max_retries,
        restart_count,
        health_cmd,
        health_interval_secs,
        health_timeout_secs,
        health_retries,
        health_startup_grace_secs,
    })
}

fn string_field(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(Value::String(s)) = obj.get(*k) {
            return Some(s.clone());
        }
    }
    None
}

fn port_from_value(v: &Value) -> Option<PortMapping> {
    let obj = v.as_object()?;
    let host = obj.get("host").and_then(Value::as_u64)? as u16;
    let guest = obj.get("guest").and_then(Value::as_u64)? as u16;
    let protocol = obj
        .get("protocol")
        .or_else(|| obj.get("proto"))
        .and_then(Value::as_str)
        .unwrap_or("tcp")
        .to_string();
    Some(PortMapping {
        host,
        guest,
        protocol,
    })
}

/// Per-machine extras scraped from `smolvm machine ls -v` (text form),
/// since the JSON variant omits env vars and mount details.
#[derive(Default)]
pub struct MachineExtras {
    pub env_count: u32,
    pub mounts: Vec<VolumeMount>,
}

/// Parse `smolvm machine ls -v` text output.
///
/// Output shape:
/// ```text
/// NAME    STATE    CPUS  MEMORY  ...
/// ----------...
/// myvm    running   4    8192 MiB ...
///   PID: 12345
///   Mount: /host -> /guest (ro)
///   Env: FOO=1
///   Created: 1700000000
/// ```
pub fn parse_machine_extras(raw: &str) -> std::collections::HashMap<String, MachineExtras> {
    let mut out: std::collections::HashMap<String, MachineExtras> =
        std::collections::HashMap::new();
    let mut current: Option<String> = None;

    for line in raw.lines() {
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if !indented {
            let trimmed = line.trim_end();
            if trimmed.is_empty() || trimmed.starts_with('-') || trimmed.starts_with("NAME") {
                current = None;
                continue;
            }
            current = trimmed.split_whitespace().next().map(str::to_string);
            continue;
        }
        let Some(name) = current.as_ref() else {
            continue;
        };
        let body = line.trim_start();
        if let Some(_rest) = body.strip_prefix("Env:") {
            out.entry(name.clone()).or_default().env_count += 1;
        } else if let Some(rest) = body.strip_prefix("Mount:") {
            if let Some(mount) = parse_mount_line(rest.trim()) {
                out.entry(name.clone()).or_default().mounts.push(mount);
            }
        }
    }
    out
}

/// Parse a mount line body like `/host -> /guest` or `/host -> /guest (ro)`.
fn parse_mount_line(s: &str) -> Option<VolumeMount> {
    let (host, rest) = s.split_once("->")?;
    let rest = rest.trim();
    let (guest, readonly) = match rest.split_once('(') {
        Some((g, flag)) => (g.trim(), flag.trim_end_matches(')').trim() == "ro"),
        None => (rest, false),
    };
    Some(VolumeMount {
        host_path: host.trim().to_string(),
        guest_path: guest.to_string(),
        readonly,
    })
}

fn parse_status(s: &str) -> MachineStatus {
    match s.to_ascii_lowercase().as_str() {
        "running" | "started" => MachineStatus::Running,
        "starting" | "pending" => MachineStatus::Starting,
        "stopped" => MachineStatus::Stopped,
        "created" => MachineStatus::Created,
        "exited" | "finished" => MachineStatus::Exited,
        "unreachable" => MachineStatus::Unreachable,
        _ => MachineStatus::Unknown,
    }
}
