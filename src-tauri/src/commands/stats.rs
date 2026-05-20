//! Host-side process sampling for per-machine and aggregate stats.
//!
//! smolvm has no `machine stats` command, so we take the PID from `machine ls`
//! and sample the vmm process with `sysinfo`. Samples include its children so
//! the balloon + vcpu threads all count.

use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, System};

use crate::commands::machines::list_machines;
use crate::types::MachineStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineStats {
    pub name: String,
    pub pid: Option<u32>,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    /// Unix seconds.
    pub timestamp: u64,
    pub alive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
    pub per_machine: Vec<MachineStats>,
    pub total_cpu_percent: f32,
    pub total_memory_bytes: u64,
    pub host_memory_total_bytes: u64,
    pub host_cpu_count: u32,
    pub timestamp: u64,
}

fn shared_system() -> &'static Mutex<System> {
    static S: OnceLock<Mutex<System>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(System::new()))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Sample the process tree rooted at `root_pid`: total CPU% (sum) and RSS (sum).
fn sample_tree(system: &System, root_pid: u32) -> Option<(f32, u64)> {
    let root = system.process(Pid::from_u32(root_pid))?;
    let mut cpu = root.cpu_usage();
    let mut mem = root.memory();

    for (_, p) in system.processes() {
        if let Some(parent) = p.parent() {
            if parent.as_u32() == root_pid {
                cpu += p.cpu_usage();
                mem += p.memory();
            }
        }
    }
    Some((cpu, mem))
}

#[tauri::command]
pub async fn machine_stats(name: String) -> Result<MachineStats, String> {
    let machines = list_machines().await?;
    let m = machines
        .into_iter()
        .find(|m| m.name == name)
        .ok_or_else(|| format!("machine `{name}` not found"))?;

    let pid = m.pid;
    let Some(pid) = pid else {
        return Ok(MachineStats {
            name,
            pid: None,
            cpu_percent: 0.0,
            memory_bytes: 0,
            timestamp: now_unix(),
            alive: false,
        });
    };

    // Two refreshes spaced briefly so CPU% has a delta to measure.
    let (cpu, mem, alive) = tauri::async_runtime::spawn_blocking(move || {
        let mut sys = shared_system().lock().unwrap();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        std::thread::sleep(std::time::Duration::from_millis(200));
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        match sample_tree(&sys, pid) {
            Some((c, m)) => (c, m, true),
            None => (0.0, 0, false),
        }
    })
    .await
    .map_err(|e| format!("sample: {e}"))?;

    Ok(MachineStats {
        name,
        pid: Some(pid),
        cpu_percent: cpu,
        memory_bytes: mem,
        timestamp: now_unix(),
        alive,
    })
}

#[tauri::command]
pub async fn system_stats() -> Result<SystemStats, String> {
    let machines = list_machines().await?;

    let pids: Vec<(String, Option<u32>, bool)> = machines
        .into_iter()
        .map(|m| {
            let is_running = matches!(
                m.status,
                MachineStatus::Running | MachineStatus::Starting | MachineStatus::Unreachable
            );
            (m.name, m.pid, is_running)
        })
        .collect();

    let (per_machine, host_mem, host_cpus) = tauri::async_runtime::spawn_blocking(move || {
        let mut sys = shared_system().lock().unwrap();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        std::thread::sleep(std::time::Duration::from_millis(200));
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        sys.refresh_memory();

        let ts = now_unix();
        let rows: Vec<MachineStats> = pids
            .into_iter()
            .filter_map(|(name, pid, running)| {
                if !running {
                    return None;
                }
                let Some(pid) = pid else {
                    return Some(MachineStats {
                        name,
                        pid: None,
                        cpu_percent: 0.0,
                        memory_bytes: 0,
                        timestamp: ts,
                        alive: false,
                    });
                };
                let (cpu, mem, alive) = match sample_tree(&sys, pid) {
                    Some((c, m)) => (c, m, true),
                    None => (0.0, 0, false),
                };
                Some(MachineStats {
                    name,
                    pid: Some(pid),
                    cpu_percent: cpu,
                    memory_bytes: mem,
                    timestamp: ts,
                    alive,
                })
            })
            .collect();

        (rows, sys.total_memory(), sys.cpus().len() as u32)
    })
    .await
    .map_err(|e| format!("sample: {e}"))?;

    let total_cpu: f32 = per_machine.iter().map(|m| m.cpu_percent).sum();
    let total_mem: u64 = per_machine.iter().map(|m| m.memory_bytes).sum();

    Ok(SystemStats {
        per_machine,
        total_cpu_percent: total_cpu,
        total_memory_bytes: total_mem,
        host_memory_total_bytes: host_mem,
        host_cpu_count: host_cpus,
        timestamp: now_unix(),
    })
}
