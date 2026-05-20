//! One-shot "run this command in the VM" tasks.
//!
//! Like `exec` but non-interactive: streams stdout / stderr back to the
//! frontend line-by-line and emits the exit code when the child ends. Holds
//! the global CLI lock for the lifetime of the task (smolvm's DB lock).

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

use crate::smolvm::cli;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskChunk {
    /// "stdout" or "stderr".
    pub stream: String,
    pub data: String,
}

/// Dropping the sender asks the waiter task to stop waiting. When the task
/// ends (naturally or via kill) the waiter removes the entry, dropping the
/// CLI guard for queued callers.
struct TaskHandle {
    kill: Option<oneshot::Sender<()>>,
}

fn tasks() -> &'static Mutex<HashMap<String, TaskHandle>> {
    static T: OnceLock<Mutex<HashMap<String, TaskHandle>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub async fn run_task(
    app: AppHandle,
    task_id: String,
    machine: String,
    command: String,
) -> Result<(), String> {
    if tasks().lock().unwrap().contains_key(&task_id) {
        return Err(format!("task {task_id} already running"));
    }

    // Pre-flight check: is the VM reachable? Mirror exec_start's behavior.
    let status = cli::run(&["machine", "status", "-n", &machine]).await?;
    let status_text = format!("{}{}", status.stdout, status.stderr);
    if !status_text.contains("running") {
        return Err(format!(
            "machine '{machine}' is not reachable ({})",
            status_text.trim()
        ));
    }

    // Hold the CLI lock for the task's lifetime so concurrent polls don't
    // collide with smolvm's DB lock.
    let cli_guard = cli::acquire_lock().await;

    let user_args: Vec<String> = vec![
        "machine".into(),
        "exec".into(),
        "--name".into(),
        machine.clone(),
        "--stream".into(),
        "--".into(),
        "sh".into(),
        "-c".into(),
        command.clone(),
    ];

    let mut cmd = Command::new(cli::current_binary());
    for (k, v) in cli::current_env() {
        cmd.env(k, v);
    }
    if let Some(cwd) = cli::current_cwd() {
        cmd.current_dir(cwd);
    }

    let mut child = cmd
        .args(cli::resolved_args(&user_args))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let stderr = child.stderr.take().ok_or("no stderr pipe")?;

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    tasks().lock().unwrap().insert(
        task_id.clone(),
        TaskHandle {
            kill: Some(kill_tx),
        },
    );

    spawn_stream_reader(app.clone(), task_id.clone(), stdout, "stdout");
    spawn_stream_reader(app.clone(), task_id.clone(), stderr, "stderr");

    // Wait for child (or kill signal), emit exit, clean up map + CLI guard.
    let id_wait = task_id.clone();
    let app_wait = app.clone();
    tokio::spawn(async move {
        let exit_code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()).unwrap_or(-1),
            _ = kill_rx => {
                let _ = child.start_kill();
                child.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1)
            }
        };
        tasks().lock().unwrap().remove(&id_wait);
        drop(cli_guard);
        let _ = app_wait.emit(&format!("task-exit-{id_wait}"), exit_code);
    });

    Ok(())
}

fn spawn_stream_reader<R>(app: AppHandle, id: String, reader: R, stream: &'static str)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let event = format!("task-output-{id}");
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        let mut buf = String::new();
        loop {
            buf.clear();
            match reader.read_line(&mut buf).await {
                Ok(0) => break,
                Ok(_) => {
                    let _ = app.emit(
                        &event,
                        TaskChunk {
                            stream: stream.to_string(),
                            data: buf.clone(),
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
pub async fn stop_task(task_id: String) -> Result<(), String> {
    let handle = tasks()
        .lock()
        .unwrap()
        .get_mut(&task_id)
        .and_then(|h| h.kill.take());
    if let Some(tx) = handle {
        let _ = tx.send(());
    }
    Ok(())
}
