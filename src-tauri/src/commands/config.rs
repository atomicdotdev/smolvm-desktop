use crate::smolvm::cli;

#[tauri::command]
pub async fn smolvm_config() -> Result<String, String> {
    cli::run_checked(&["config", "show"]).await
}
