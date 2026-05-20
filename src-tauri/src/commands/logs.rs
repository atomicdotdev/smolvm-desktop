//! Tail `<data-dir>/agent-console.log` for a machine and stream lines to the frontend.
//!
//! The file is append-only per boot and recreated across boots; we watch size,
//! reset on shrink, and emit each complete newline-terminated line as an event.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, AsyncSeekExt, BufReader, SeekFrom};
use tokio::sync::watch;

use crate::smolvm::cli;

/// Registry of active log tailers keyed by machine name. Dropping the sender stops the task.
fn registry() -> &'static Mutex<HashMap<String, watch::Sender<bool>>> {
    static R: OnceLock<Mutex<HashMap<String, watch::Sender<bool>>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn data_dir(name: &str) -> Result<PathBuf, String> {
    let out = cli::run_checked(&["machine", "data-dir", name]).await?;
    Ok(PathBuf::from(out.trim()))
}

#[tauri::command]
pub async fn machine_data_dir(name: String) -> Result<String, String> {
    Ok(data_dir(&name).await?.display().to_string())
}

/// Read a snapshot of the log. `tail` caps the number of most-recent lines returned.
#[tauri::command]
pub async fn machine_log_snapshot(name: String, tail: Option<usize>) -> Result<Vec<String>, String> {
    let dir = data_dir(&name).await?;
    let path = dir.join("agent-console.log");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read log: {e}"))?;
    let lines: Vec<String> = contents.lines().map(str::to_string).collect();
    if let Some(n) = tail {
        let start = lines.len().saturating_sub(n);
        Ok(lines[start..].to_vec())
    } else {
        Ok(lines)
    }
}

/// Start tailing a machine's agent log. Emits `agent-log-<name>` events, one per line.
/// Calling again while already active replaces the previous tailer.
#[tauri::command]
pub async fn machine_log_follow(app: AppHandle, name: String) -> Result<(), String> {
    stop_follow(&name);

    let (tx, mut rx) = watch::channel(false);
    registry().lock().unwrap().insert(name.clone(), tx);

    let dir = data_dir(&name).await?;
    let path = dir.join("agent-console.log");
    let event = format!("agent-log-{}", name);

    tokio::spawn(async move {
        let mut offset: u64 = 0;
        let mut pending = String::new();

        loop {
            if *rx.borrow() {
                break;
            }
            if let Ok(meta) = tokio::fs::metadata(&path).await {
                let len = meta.len();
                if len < offset {
                    // file shrank — recreated on reboot
                    offset = 0;
                    pending.clear();
                }
                if len > offset {
                    match File::open(&path).await {
                        Ok(mut f) => {
                            if f.seek(SeekFrom::Start(offset)).await.is_ok() {
                                let mut reader = BufReader::new(f);
                                loop {
                                    let mut buf = String::new();
                                    match reader.read_line(&mut buf).await {
                                        Ok(0) => break,
                                        Ok(n) => {
                                            offset += n as u64;
                                            pending.push_str(&buf);
                                            if pending.ends_with('\n') {
                                                for line in pending.lines() {
                                                    let _ = app.emit(&event, line.to_string());
                                                }
                                                pending.clear();
                                            }
                                        }
                                        Err(_) => break,
                                    }
                                }
                            }
                        }
                        Err(_) => {}
                    }
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                _ = rx.changed() => {
                    if *rx.borrow() { break; }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn machine_log_stop(name: String) -> Result<(), String> {
    stop_follow(&name);
    Ok(())
}

fn stop_follow(name: &str) {
    if let Some(tx) = registry().lock().unwrap().remove(name) {
        let _ = tx.send(true);
    }
}
