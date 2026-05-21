use crate::smolvm::cli;

#[tauri::command]
pub async fn smolvm_config() -> Result<String, String> {
    cli::run_checked(&["config", "show"]).await
}

#[tauri::command]
pub async fn get_registries_path() -> Result<String, String> {
    let out = cli::run_checked(&["config", "registries", "path"]).await?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn read_registries() -> Result<String, String> {
    cli::run_checked(&["config", "registries", "show"]).await
}

#[tauri::command]
pub async fn registries_example() -> Result<String, String> {
    cli::run_checked(&["config", "registries", "example"]).await
}

/// Write directly to the registries config path. smolvm's `config registries
/// edit` shells out to $EDITOR, which is unusable from a GUI — so we resolve
/// the path via `config registries path` and write the file ourselves. smolvm
/// validates the contents on its next invocation.
#[tauri::command]
pub async fn write_registries(content: String) -> Result<(), String> {
    let path = get_registries_path().await?;
    let path = path.trim();
    if path.is_empty() {
        return Err("smolvm returned an empty registries path".to_string());
    }
    if let Some(parent) = std::path::Path::new(path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create registries dir {}: {e}", parent.display()))?;
    }
    std::fs::write(path, content).map_err(|e| format!("write {path}: {e}"))?;
    Ok(())
}
