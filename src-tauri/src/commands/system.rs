use crate::smolvm::cli;
use crate::types::{HealthStatus, SmolvmBinary, SystemInfo};

#[tauri::command]
pub async fn set_smolvm_binary(
    path: Option<String>,
    env: Option<Vec<(String, String)>>,
    cwd: Option<String>,
    prefix_args: Option<Vec<String>>,
    arg_join: Option<String>,
) -> Result<HealthStatus, String> {
    cli::set_config(
        path,
        env.unwrap_or_default(),
        cwd,
        prefix_args.unwrap_or_default(),
        arg_join,
    );
    smolvm_health().await
}

#[tauri::command]
pub fn get_smolvm_binary() -> SmolvmBinary {
    SmolvmBinary {
        path: cli::current_binary(),
        env: cli::current_env(),
        cwd: cli::current_cwd(),
        prefix_args: cli::current_prefix_args(),
        arg_join: cli::current_arg_join(),
    }
}

#[tauri::command]
pub async fn smolvm_health() -> Result<HealthStatus, String> {
    match cli::version().await {
        Ok(v) => Ok(HealthStatus {
            healthy: true,
            version: Some(v),
            error: None,
        }),
        Err(e) => Ok(HealthStatus {
            healthy: false,
            version: None,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn system_info() -> Result<SystemInfo, String> {
    let version = cli::version().await.ok();
    Ok(SystemInfo {
        smolvm_version: version,
        smolvm_path: cli::binary_path(),
    })
}
