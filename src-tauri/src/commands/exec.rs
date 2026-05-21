//! Exec session manager: spawns `smolvm machine exec -n NAME -it -- <cmd>` under a
//! portable-pty master, bridges bytes to Tauri events keyed by session id.
//!
//! Events:
//! - `exec-data-<id>`  string of bytes written to the terminal (combined stdout+stderr)
//! - `exec-exit-<id>`  number exit code (emitted once when the child exits)
//!
//! Commands: [`exec_start`], [`exec_write`], [`exec_resize`], [`exec_stop`].

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tauri::{AppHandle, Emitter};
use tokio::sync::OwnedMutexGuard;

use crate::smolvm::cli;

struct Session {
    machine: String,
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    // Held for the lifetime of the exec — serializes against all other CLI calls.
    _cli_guard: OwnedMutexGuard<()>,
}

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static S: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Session ids that were stopped before their `exec_start` finished inserting.
/// `exec_start` checks this on completion so racing cleanups never orphan a
/// running child + lock guard.
fn pending_cancels() -> &'static Mutex<HashSet<String>> {
    static C: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashSet::new()))
}

#[tauri::command]
pub async fn exec_start(
    app: AppHandle,
    session_id: String,
    machine: String,
    command: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    if sessions().lock().unwrap().contains_key(&session_id) {
        return Err(format!("session {session_id} already running"));
    }

    // Pre-flight: `machine ls` caches state, so a VM can report "running" long
    // after its vmm process died. `status` actually probes liveness.
    let status = cli::run(&["machine", "status", "-n", &machine]).await?;
    let status_text = format!("{}{}", status.stdout, status.stderr);
    if !status_text.contains("running") {
        return Err(format!(
            "machine '{machine}' is not reachable ({})",
            status_text.trim()
        ));
    }

    // Default shell: prefer bash interactive so readline-driven features like
    // bracketed paste mode work (multi-line pastes with `\\`-continuations
    // would otherwise race the shell's line buffer). Falls back to plain sh
    // for minimal images (alpine, distroless) that don't ship bash.
    //
    // The outer `sh` is bash invoked as `sh` on most distros — that sets
    // POSIXLY_CORRECT, which propagates through `exec bash -i` and re-enters
    // POSIX mode (disabling readline, using the `sh-5.2#` prompt). Unset it
    // first so the exec'd bash starts as a normal interactive shell.
    //
    // Some distros (Fedora) ship /etc/inputrc with `enable-bracketed-paste
    // off`. Override via INPUTRC pointing at a tiny file we write that only
    // enables bracketed paste — without it multi-line pastes race the shell's
    // line buffer the same way POSIX mode did.
    let cmd = command.unwrap_or_else(|| {
        "sh -c 'unset POSIXLY_CORRECT; \
         printf \"%s\\n\" \"set enable-bracketed-paste on\" > /tmp/.smolvm-inputrc 2>/dev/null; \
         export INPUTRC=/tmp/.smolvm-inputrc; \
         if command -v bash >/dev/null 2>&1; then exec bash -i; else exec sh; fi'"
            .to_string()
    });
    // For the default shell-chooser we want to keep the single-quoted argument
    // intact rather than naive whitespace split. Detect that shape and pass
    // through verbatim; otherwise fall back to whitespace splitting which
    // covers the common `python3 -i` case.
    let cmd_parts: Vec<String> = if cmd.starts_with("sh -c '") && cmd.ends_with('\'') {
        let inner = &cmd["sh -c '".len()..cmd.len() - 1];
        vec!["sh".into(), "-c".into(), inner.into()]
    } else {
        cmd.split_whitespace()
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    if cmd_parts.is_empty() {
        return Err("command is empty".into());
    }

    // Acquire the global CLI lock for the lifetime of this exec session.
    // Other CLI calls (poll, list_files, ...) will queue until the session ends.
    let cli_guard = cli::acquire_lock().await;

    let pty = NativePtySystem::default();
    let pair = pty
        .openpty(PtySize {
            cols: cols.unwrap_or(80),
            rows: rows.unwrap_or(24),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let mut builder = CommandBuilder::new(cli::current_binary());
    let mut user_args: Vec<String> = vec![
        "machine".into(),
        "exec".into(),
        "--name".into(),
        machine.clone(),
        "-i".into(),
        "-t".into(),
        "--".into(),
    ];
    user_args.extend(cmd_parts);
    builder.args(cli::resolved_args(&user_args));
    // Give the child a sane PATH and TERM so shells work.
    builder.env("TERM", "xterm-256color");
    if let Ok(path) = std::env::var("PATH") {
        builder.env("PATH", path);
    }
    // User-configured env (dev builds with DYLD_LIBRARY_PATH, SMOLVM_AGENT_ROOTFS, …).
    for (k, v) in cli::current_env() {
        builder.env(k, v);
    }
    if let Some(cwd) = cli::current_cwd() {
        builder.cwd(cwd);
    }

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("spawn smolvm exec: {e}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer: {e}"))?;

    // If a cleanup already fired `exec_stop` for this id while we were setting
    // up, honor it: kill the child and drop the guard without ever publishing
    // the session.
    if pending_cancels().lock().unwrap().remove(&session_id) {
        let mut child = child;
        let _ = child.kill();
        drop(cli_guard);
        drop(pair.master);
        drop(writer);
        return Ok(());
    }

    sessions().lock().unwrap().insert(
        session_id.clone(),
        Session {
            machine: machine.clone(),
            writer,
            master: pair.master,
            child,
            _cli_guard: cli_guard,
        },
    );

    let event_data = format!("exec-data-{session_id}");
    let event_exit = format!("exec-exit-{session_id}");
    let id_for_reader = session_id.clone();
    let app_reader = app.clone();

    // Blocking reader task (PTY reads are blocking). Own thread keeps the runtime free.
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let s = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_reader.emit(&event_data, s);
                }
                Err(_) => break,
            }
        }

        // Reader hit EOF — wait for child to finish and emit exit
        let code = {
            let mut map = sessions().lock().unwrap();
            match map.remove(&id_for_reader) {
                Some(mut s) => match s.child.wait() {
                    Ok(status) => status.exit_code() as i32,
                    Err(_) => -1,
                },
                None => -1,
            }
        };
        let _ = app_reader.emit(&event_exit, code);
    });

    Ok(())
}

#[tauri::command]
pub async fn exec_write(session_id: String, data: String) -> Result<(), String> {
    let mut map = sessions().lock().unwrap();
    let session = map
        .get_mut(&session_id)
        .ok_or_else(|| format!("session {session_id} not found"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    session.writer.flush().ok();
    Ok(())
}

#[tauri::command]
pub async fn exec_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = sessions().lock().unwrap();
    let session = map
        .get(&session_id)
        .ok_or_else(|| format!("session {session_id} not found"))?;
    session
        .master
        .resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn exec_stop(session_id: String) -> Result<(), String> {
    let mut map = sessions().lock().unwrap();
    if let Some(mut s) = map.remove(&session_id) {
        let _ = s.child.kill();
    } else {
        // `exec_start` hasn't inserted yet; tell it to bail on completion.
        pending_cancels().lock().unwrap().insert(session_id);
    }
    Ok(())
}

/// Kill every session tied to `machine`. Used before stop/restart/delete so the
/// action doesn't queue behind a long-held exec lock.
pub fn kill_sessions_for(machine: &str) {
    let mut map = sessions().lock().unwrap();
    let ids: Vec<String> = map
        .iter()
        .filter(|(_, s)| s.machine == machine)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        if let Some(mut s) = map.remove(&id) {
            let _ = s.child.kill();
        }
    }
}
