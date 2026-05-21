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

/// Read the raw TOML contents of the registries config file. `smolvm config
/// registries show` returns a *summary* ("No registries configured…"), not the
/// raw file, so we read directly. Returns an empty string if the file doesn't
/// exist yet — the editor will start blank in that case.
#[tauri::command]
pub async fn read_registries() -> Result<String, String> {
    let path = get_registries_path().await?;
    let path = path.trim();
    if path.is_empty() {
        return Err("smolvm returned an empty registries path".to_string());
    }
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("read {path}: {e}")),
    }
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
