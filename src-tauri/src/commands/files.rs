//! Browse / read / write files inside a machine via `smolvm machine exec` and
//! `smolvm machine cp`. We rely on busybox-friendly primitives (`find`, `stat`,
//! `cat`, `tee`) so these work on Alpine as well as glibc distros.

use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::smolvm::cli;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64, // unix seconds
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContent {
    pub text: Option<String>,
    pub binary: bool,
    pub size: u64,
}

/// List one level of a directory inside the VM.
#[tauri::command]
pub async fn list_files(name: String, path: String) -> Result<Vec<FileEntry>, String> {
    // `-exec {} +` batches like xargs but is a no-op on empty directories
    // (which `xargs` is not — it would invoke stat with zero args and fail).
    let script = format!(
        r#"find {p} -mindepth 1 -maxdepth 1 -exec stat -c "%n|%F|%s|%Y" {{}} + 2>/dev/null"#,
        p = shell_escape(&path),
    );
    let out = cli::run_checked(&[
        "machine", "exec", "--name", &name, "--", "sh", "-c", &script,
    ])
    .await?;

    let mut entries: Vec<FileEntry> = out
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(parse_stat_line)
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

/// Read a file from the VM. Returns decoded text or a binary-flagged empty body.
#[tauri::command]
pub async fn read_file(name: String, path: String) -> Result<FileContent, String> {
    // Use `head -c` via a small byte limit so we don't pull gigabytes accidentally.
    let script = format!(
        "head -c 1048576 {p} 2>/dev/null; printf '\\n__SMOLVM_END__'; stat -c '%s' {p} 2>/dev/null",
        p = shell_escape(&path),
    );
    let out = cli::run_checked(&[
        "machine", "exec", "--name", &name, "--", "sh", "-c", &script,
    ])
    .await?;

    let (body, tail) = match out.rsplit_once("__SMOLVM_END__") {
        Some((b, t)) => (b, t.trim()),
        None => (out.as_str(), ""),
    };
    // The printf above adds a trailing newline before the marker — trim one.
    let body = body.strip_suffix('\n').unwrap_or(body);
    let size: u64 = tail.parse().unwrap_or(body.len() as u64);

    let binary = body.as_bytes().contains(&0);
    if binary {
        Ok(FileContent {
            text: None,
            binary: true,
            size,
        })
    } else {
        Ok(FileContent {
            text: Some(body.to_string()),
            binary: false,
            size,
        })
    }
}

/// Overwrite a file inside the VM. Piped via `tee` over stdin.
#[tauri::command]
pub async fn write_file(name: String, path: String, content: String) -> Result<(), String> {
    let _guard = cli::acquire_lock().await;
    let mut cmd = Command::new(cli::current_binary());
    for (k, v) in cli::current_env() {
        cmd.env(k, v);
    }
    if let Some(cwd) = cli::current_cwd() {
        cmd.current_dir(cwd);
    }
    let user_args: Vec<String> = vec![
        "machine".into(),
        "exec".into(),
        "--name".into(),
        name.clone(),
        "-i".into(),
        "--".into(),
        "sh".into(),
        "-c".into(),
        format!("cat > {}", shell_escape(&path)),
    ];
    let mut child = cmd
        .args(cli::resolved_args(&user_args))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn exec: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(content.as_bytes())
            .await
            .map_err(|e| format!("write stdin: {e}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| format!("close stdin: {e}"))?;
    }

    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("wait: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Copy a host file into the VM.
#[tauri::command]
pub async fn upload_file(
    name: String,
    host_path: String,
    vm_path: String,
) -> Result<(), String> {
    let dst = format!("{name}:{vm_path}");
    cli::run_checked(&["machine", "cp", &host_path, &dst]).await?;
    Ok(())
}

/// Copy a file from the VM to the host.
#[tauri::command]
pub async fn download_file(
    name: String,
    vm_path: String,
    host_path: String,
) -> Result<(), String> {
    let src = format!("{name}:{vm_path}");
    cli::run_checked(&["machine", "cp", &src, &host_path]).await?;
    Ok(())
}

fn parse_stat_line(line: &str) -> Option<FileEntry> {
    // "%n|%F|%s|%Y"
    let parts: Vec<&str> = line.splitn(4, '|').collect();
    if parts.len() != 4 {
        return None;
    }
    let path = parts[0].to_string();
    let kind = parts[1];
    let size: u64 = parts[2].parse().ok()?;
    let modified: u64 = parts[3].parse().ok()?;
    let name = path
        .rsplit('/')
        .next()
        .unwrap_or(&path)
        .to_string();
    let is_dir = kind.contains("directory");
    Some(FileEntry {
        name,
        path,
        is_dir,
        size,
        modified,
    })
}

fn shell_escape(s: &str) -> String {
    // Single-quote wrap, escape any embedded single quote.
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}
