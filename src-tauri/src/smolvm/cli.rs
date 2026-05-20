use std::process::Stdio;
use std::sync::{Arc, RwLock};
use tokio::process::Command;
use tokio::sync::{Mutex, OwnedMutexGuard};

const DEFAULT_BIN: &str = "smolvm";

#[derive(Clone, Default)]
pub struct BinaryConfig {
    pub path: String,
    pub env: Vec<(String, String)>,
    /// Working directory the subprocess runs in. Makes relative env paths
    /// (`DYLD_LIBRARY_PATH=./lib`, etc.) resolve against a known root.
    pub cwd: Option<String>,
    /// Fixed args prepended before user args. Lets users run via a wrapper
    /// like `cargo make smolvm …` by setting path="cargo" + prefix=["make","smolvm"].
    pub prefix_args: Vec<String>,
    /// If set, the user args are joined into a single argument with this
    /// separator. Required for cargo-make tasks that parse
    /// `CARGO_MAKE_TASK_ARGS` as a `;`-separated list.
    pub arg_join: Option<String>,
}

fn config() -> &'static RwLock<BinaryConfig> {
    use std::sync::OnceLock;
    static C: OnceLock<RwLock<BinaryConfig>> = OnceLock::new();
    C.get_or_init(|| {
        RwLock::new(BinaryConfig {
            path: DEFAULT_BIN.to_string(),
            env: Vec::new(),
            cwd: None,
            prefix_args: Vec::new(),
            arg_join: None,
        })
    })
}

/// Current smolvm binary path (or bare name for PATH lookup).
pub fn current_binary() -> String {
    config().read().unwrap().path.clone()
}

/// Env vars to inject into every smolvm subprocess (for dev builds needing
/// `DYLD_LIBRARY_PATH` + `SMOLVM_AGENT_ROOTFS`, etc.).
pub fn current_env() -> Vec<(String, String)> {
    config().read().unwrap().env.clone()
}

/// Working directory used for every smolvm subprocess, if configured.
pub fn current_cwd() -> Option<String> {
    config().read().unwrap().cwd.clone()
}

/// Fixed args prepended before user args on every invocation.
pub fn current_prefix_args() -> Vec<String> {
    config().read().unwrap().prefix_args.clone()
}

/// Separator for joining user args into one argv entry (for cargo-make-style
/// task runners). None → args are passed through as separate argv entries.
pub fn current_arg_join() -> Option<String> {
    config().read().unwrap().arg_join.clone()
}

/// Build the final argv for a given user-arg list, honoring prefix + join.
pub fn resolved_args<S: AsRef<str>>(user_args: &[S]) -> Vec<String> {
    let prefix = current_prefix_args();
    let mut out: Vec<String> = prefix;
    match current_arg_join() {
        Some(sep) => out.push(
            user_args
                .iter()
                .map(|s| s.as_ref().to_string())
                .collect::<Vec<_>>()
                .join(&sep),
        ),
        None => out.extend(user_args.iter().map(|s| s.as_ref().to_string())),
    }
    out
}

/// Override the binary config. `None` path resets to the default PATH lookup.
pub fn set_config(
    path: Option<String>,
    env: Vec<(String, String)>,
    cwd: Option<String>,
    prefix_args: Vec<String>,
    arg_join: Option<String>,
) {
    let mut c = config().write().unwrap();
    c.path = match path {
        Some(p) if !p.trim().is_empty() => p,
        _ => DEFAULT_BIN.to_string(),
    };
    c.env = env
        .into_iter()
        .filter(|(k, _)| !k.trim().is_empty())
        .collect();
    c.cwd = blank_to_none(cwd);
    c.prefix_args = prefix_args
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    c.arg_join = blank_to_none(arg_join);
}

fn blank_to_none(s: Option<String>) -> Option<String> {
    s.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    })
}

/// Global serialization lock for the smolvm CLI.
///
/// smolvm uses a single-writer file lock on its state DB; concurrent invocations
/// collide with "Database already open. Cannot acquire lock." Every CLI call in
/// this app must acquire this mutex first. Long-lived invocations (exec PTY
/// sessions) hold an owned guard for their lifetime — dropping it releases the
/// lock for queued callers.
pub fn lock() -> &'static Arc<Mutex<()>> {
    use std::sync::OnceLock;
    static L: OnceLock<Arc<Mutex<()>>> = OnceLock::new();
    L.get_or_init(|| Arc::new(Mutex::new(())))
}

pub async fn acquire_lock() -> OwnedMutexGuard<()> {
    lock().clone().lock_owned().await
}

pub struct CliOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

pub async fn run(args: &[&str]) -> Result<CliOutput, String> {
    let _guard = lock().lock().await;
    run_unlocked(args).await
}

/// Run without acquiring the global lock. Only use this when you already hold
/// the lock (e.g. from `acquire_lock`) or are intentionally racing (never).
pub async fn run_unlocked(args: &[&str]) -> Result<CliOutput, String> {
    let bin = current_binary();
    let mut cmd = Command::new(&bin);
    for (k, v) in current_env() {
        cmd.env(k, v);
    }
    if let Some(cwd) = current_cwd() {
        cmd.current_dir(cwd);
    }
    let final_args = resolved_args(args);
    let output = cmd
        .args(&final_args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("`{bin}` not found in PATH")
            } else {
                format!("failed to run `{bin}`: {e}")
            }
        })?;

    Ok(CliOutput {
        stdout: strip_launcher_noise(&String::from_utf8_lossy(&output.stdout)),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        success: output.status.success(),
    })
}

/// Remove `[cargo-make] INFO - …` banner lines (and similar known launcher
/// chatter) from stdout so downstream parsers see only the smolvm binary's
/// actual output.
fn strip_launcher_noise(s: &str) -> String {
    s.lines()
        .filter(|line| !line.trim_start().starts_with("[cargo-make]"))
        .collect::<Vec<_>>()
        .join("\n")
}

pub async fn run_checked(args: &[&str]) -> Result<String, String> {
    let out = run(args).await?;
    if out.success {
        return Ok(out.stdout);
    }

    // Combine stderr + stdout so callers see the full story. smolvm often
    // prints the wrapping error on stderr and the root cause (package names,
    // script output) on stdout — we want both.
    let stderr = out.stderr.trim();
    let stdout = out.stdout.trim();
    let msg = match (stderr.is_empty(), stdout.is_empty()) {
        (true, true) => "(no output)".to_string(),
        (false, true) => stderr.to_string(),
        (true, false) => stdout.to_string(),
        (false, false) => format!("{stderr}\n{stdout}"),
    };
    Err(format!("smolvm {}: {msg}", args.join(" ")))
}

pub async fn version() -> Result<String, String> {
    let out = run_checked(&["--version"]).await?;
    // output like: "smolvm 0.5.19"
    Ok(out.trim().to_string())
}

pub fn binary_path() -> Option<String> {
    let bin = current_binary();
    // Absolute / relative path: report as-is if it exists.
    let p = std::path::Path::new(&bin);
    if p.is_absolute() || bin.contains('/') {
        return if p.is_file() { Some(bin) } else { None };
    }
    which(&bin)
}

fn which(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return candidate.to_str().map(|s| s.to_string());
        }
    }
    None
}
