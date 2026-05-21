//! Supervisor manager: spawns `smolvm machine monitor -n NAME` as a long-lived
//! background child process per machine, streams its stdout/stderr lines to
//! the UI as Tauri events, and exposes start/stop/status controls.
//!
//! Without a supervisor running, persisted restart/health policy is dead config
//! — `machine monitor` is what actually enforces it.
//!
//! Events (per machine):
//! - `supervisor-log-<name>`  string, one line of stdout or stderr at a time
//! - `supervisor-exit-<name>` number, child exit code (emitted once when the
//!   child exits)
//!
//! Commands: [`supervise_start`], [`supervise_stop`], [`supervise_status`],
//! [`list_supervised`].
//!
//! Design notes:
//! - Distinct from the exec session manager (`commands::exec`): no PTY, plain
//!   piped stdout/stderr. Separate `HashMap` keyed by machine name (the exec
//!   map is keyed by session id and may contain multiple sessions per machine).
//! - SIGINT (not SIGKILL, not SIGTERM): smolvm installs its own Ctrl+C handler
//!   that sets `user_stopped` so the supervisor loop exits cleanly without
//!   restarting the machine. SIGTERM is not honored the same way. We fall back
//!   to SIGKILL only if SIGINT doesn't take effect within a few seconds.
//! - `kill_on_drop` is left at the default (`false`) — explicit cleanup gives
//!   us a chance to send SIGINT first and read any final log lines.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::smolvm::cli;
use crate::types::{MonitorOverrides, SupervisorStatus};

/// Number of log lines we keep per supervisor for backfill.
const LOG_BUFFER_CAP: usize = 200;

struct Supervisor {
    machine: String,
    overrides: MonitorOverrides,
    started_at: SystemTime,
    /// Log ring buffer (oldest → newest), bounded by `LOG_BUFFER_CAP`.
    log_buffer: Mutex<VecDeque<String>>,
    /// `Some(code)` once the child has exited.
    exit_code: Mutex<Option<i32>>,
    /// The child handle, taken on stop. `Mutex<Option<...>>` so the reader
    /// task and `supervise_stop` can both attempt to claim it; whichever
    /// wins owns the wait.
    child: Mutex<Option<Child>>,
}

fn supervisors() -> &'static std::sync::Mutex<HashMap<String, Arc<Supervisor>>> {
    static S: OnceLock<std::sync::Mutex<HashMap<String, Arc<Supervisor>>>> = OnceLock::new();
    S.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn now_millis(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Build the argv passed to the smolvm binary for `machine monitor`.
/// Only override fields that are Some/non-empty are emitted.
fn build_monitor_args(name: &str, overrides: &MonitorOverrides) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "machine".into(),
        "monitor".into(),
        "-n".into(),
        name.to_string(),
    ];
    if let Some(r) = overrides.restart.as_ref().and_then(non_empty) {
        args.push("--restart".into());
        args.push(r);
    }
    if let Some(cmd) = overrides.health_cmd.as_ref().and_then(non_empty) {
        args.push("--health-cmd".into());
        args.push(cmd);
    }
    if let Some(t) = overrides.health_timeout_secs {
        args.push("--health-timeout".into());
        args.push(format!("{t}s"));
    }
    if let Some(i) = overrides.interval_secs {
        args.push("--interval".into());
        args.push(format!("{i}s"));
    }
    if let Some(r) = overrides.health_retries {
        args.push("--health-retries".into());
        args.push(r.to_string());
    }
    args
}

fn non_empty(s: &String) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

#[tauri::command]
pub async fn supervise_start(
    app: AppHandle,
    name: String,
    overrides: MonitorOverrides,
) -> Result<(), String> {
    // Idempotent-ish: error if a supervisor is already running for this machine.
    // Caller (UI) is expected to call `supervise_stop` first if it wants to
    // restart with different overrides. This keeps the contract simple — the
    // UI shows a "Restart supervisor to apply" hint when overrides change.
    {
        let map = supervisors().lock().unwrap();
        if map.contains_key(&name) {
            return Err(format!("supervisor already running for '{name}'"));
        }
    }

    let user_args = build_monitor_args(&name, &overrides);
    let resolved = cli::resolved_args(&user_args);

    let mut cmd = Command::new(cli::current_binary());
    cmd.args(&resolved);
    for (k, v) in cli::current_env() {
        cmd.env(k, v);
    }
    if let Some(cwd) = cli::current_cwd() {
        cmd.current_dir(cwd);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    // We send SIGINT explicitly; don't let Drop SIGKILL race with cleanup.
    cmd.kill_on_drop(false);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn smolvm machine monitor: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child stdout missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "child stderr missing".to_string())?;

    let sup = Arc::new(Supervisor {
        machine: name.clone(),
        overrides,
        started_at: SystemTime::now(),
        log_buffer: Mutex::new(VecDeque::with_capacity(LOG_BUFFER_CAP)),
        exit_code: Mutex::new(None),
        child: Mutex::new(Some(child)),
    });

    supervisors()
        .lock()
        .unwrap()
        .insert(name.clone(), sup.clone());

    let event_log = format!("supervisor-log-{name}");
    let event_exit = format!("supervisor-exit-{name}");

    // Stdout reader.
    {
        let app = app.clone();
        let sup = sup.clone();
        let event_log = event_log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                push_line(&sup, &line).await;
                let _ = app.emit(&event_log, line);
            }
        });
    }

    // Stderr reader (we treat stderr as just more log lines).
    {
        let app = app.clone();
        let sup = sup.clone();
        let event_log = event_log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                push_line(&sup, &line).await;
                let _ = app.emit(&event_log, line);
            }
        });
    }

    // Wait task: blocks on child.wait(), then emits exit + removes from map.
    {
        let app = app.clone();
        let sup = sup.clone();
        let name_for_wait = name.clone();
        tokio::spawn(async move {
            // Take the child out so wait() owns it. If `supervise_stop` already
            // grabbed it, we just skip waiting here (stop_for_machine handles
            // the wait itself).
            let mut child_opt = sup.child.lock().await.take();
            let code = match child_opt.as_mut() {
                Some(c) => c.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1),
                None => -1,
            };
            *sup.exit_code.lock().await = Some(code);
            // Remove from registry — but only if we still own it. (A
            // concurrent supervise_stop may have replaced/removed already.)
            {
                let mut map = supervisors().lock().unwrap();
                if let Some(existing) = map.get(&name_for_wait) {
                    if Arc::ptr_eq(existing, &sup) {
                        map.remove(&name_for_wait);
                    }
                }
            }
            let _ = app.emit(&event_exit, code);
        });
    }

    Ok(())
}

async fn push_line(sup: &Supervisor, line: &str) {
    let mut buf = sup.log_buffer.lock().await;
    if buf.len() == LOG_BUFFER_CAP {
        buf.pop_front();
    }
    buf.push_back(line.to_string());
}

#[tauri::command]
pub async fn supervise_stop(name: String) -> Result<(), String> {
    stop_for_machine(&name).await;
    Ok(())
}

/// Internal helper invoked by lifecycle hooks (`stop_machine`,
/// `delete_machine`) before they touch the VM. Safe to call when no
/// supervisor exists for the machine — it's a no-op.
pub async fn stop_for_machine(name: &str) {
    let sup = {
        let mut map = supervisors().lock().unwrap();
        map.remove(name)
    };
    let Some(sup) = sup else {
        return;
    };

    // Take the child out from under any concurrent reader-spawned wait task.
    let Some(mut child) = sup.child.lock().await.take() else {
        return; // Already reaped.
    };

    // SIGINT triggers smolvm's user_stopped path and lets the supervisor
    // loop exit cleanly.
    if let Some(pid) = child.id() {
        send_sigint(pid as i32);
    }

    // Give the child a few seconds to exit on its own.
    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;

    // If it's still alive, fall back to SIGKILL.
    if let Ok(None) = child.try_wait() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    // Record the exit so any in-flight status query reflects it.
    let code = child
        .try_wait()
        .ok()
        .flatten()
        .and_then(|s| s.code())
        .unwrap_or(-1);
    *sup.exit_code.lock().await = Some(code);
}

#[cfg(unix)]
fn send_sigint(pid: i32) {
    // SAFETY: kill(2) with SIGINT on a process we just spawned. The pid is
    // a valid pid from tokio::process::Child::id(); worst case the process
    // has already exited and kill() returns ESRCH which we ignore.
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGINT);
    }
}

#[cfg(not(unix))]
fn send_sigint(_pid: i32) {
    // No Unix signals on Windows; the cross-platform fallback is to drop the
    // child (we don't currently support Windows builds, but keep the build
    // green if someone tries).
}

#[tauri::command]
pub async fn supervise_status(name: String) -> Option<SupervisorStatus> {
    let sup = {
        let map = supervisors().lock().unwrap();
        map.get(&name).cloned()
    }?;
    let log_tail: Vec<String> = sup.log_buffer.lock().await.iter().cloned().collect();
    let exit_code = *sup.exit_code.lock().await;
    Some(SupervisorStatus {
        machine: sup.machine.clone(),
        overrides: sup.overrides.clone(),
        started_at_ms: now_millis(sup.started_at),
        exit_code,
        log_tail,
    })
}

#[tauri::command]
pub fn list_supervised() -> Vec<String> {
    supervisors().lock().unwrap().keys().cloned().collect()
}

/// Snapshot of the supervised machine names + their child PIDs, taken
/// synchronously. Used by the app-quit cleanup so we can SIGINT all children
/// without needing async on the way out.
pub fn supervised_pids() -> Vec<(String, Option<u32>)> {
    let map = supervisors().lock().unwrap();
    let mut out = Vec::with_capacity(map.len());
    for (name, sup) in map.iter() {
        // try_lock on the child mutex: if a stop is already in flight we
        // skip — that path is handling cleanup itself.
        if let Ok(guard) = sup.child.try_lock() {
            let pid = guard.as_ref().and_then(|c| c.id());
            out.push((name.clone(), pid));
        }
    }
    out
}

/// Best-effort synchronous cleanup for app exit. Sends SIGINT to every
/// supervised child, gives them ~2s, then SIGKILLs stragglers. Called from the
/// Tauri builder's `on_window_event` for the main window's CloseRequested.
///
/// Note: this is called from the Tauri runtime context; we use a blocking
/// thread + std::thread::sleep rather than tokio to keep the shutdown path
/// independent of runtime state.
pub fn shutdown_all_blocking() {
    let entries = supervised_pids();
    if entries.is_empty() {
        return;
    }

    // First pass: SIGINT.
    for (_, pid) in &entries {
        if let Some(pid) = pid {
            send_sigint(*pid as i32);
        }
    }

    // Wait up to ~2.5s, polling every 100ms to see if everyone has exited.
    let deadline = std::time::Instant::now() + Duration::from_millis(2500);
    loop {
        if supervisors().lock().unwrap().is_empty() {
            break;
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    // Second pass: SIGKILL anything still in the map.
    #[cfg(unix)]
    {
        let map = supervisors().lock().unwrap();
        for (_, sup) in map.iter() {
            if let Ok(guard) = sup.child.try_lock() {
                if let Some(pid) = guard.as_ref().and_then(|c| c.id()) {
                    unsafe {
                        libc::kill(pid as libc::pid_t, libc::SIGKILL);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_minimal() {
        let args = build_monitor_args("vm1", &MonitorOverrides::default());
        assert_eq!(args, vec!["machine", "monitor", "-n", "vm1"]);
    }

    #[test]
    fn argv_with_overrides() {
        let overrides = MonitorOverrides {
            restart: Some("on-failure".into()),
            health_cmd: Some("curl -f http://127.0.0.1:8080/health".into()),
            health_timeout_secs: Some(2),
            interval_secs: Some(10),
            health_retries: Some(3),
        };
        let args = build_monitor_args("vm1", &overrides);
        assert_eq!(
            args,
            vec![
                "machine",
                "monitor",
                "-n",
                "vm1",
                "--restart",
                "on-failure",
                "--health-cmd",
                "curl -f http://127.0.0.1:8080/health",
                "--health-timeout",
                "2s",
                "--interval",
                "10s",
                "--health-retries",
                "3",
            ]
        );
    }

    #[test]
    fn argv_skips_blank_strings() {
        let overrides = MonitorOverrides {
            restart: Some("   ".into()),
            health_cmd: Some("".into()),
            ..Default::default()
        };
        let args = build_monitor_args("vm1", &overrides);
        assert_eq!(args, vec!["machine", "monitor", "-n", "vm1"]);
    }
}
