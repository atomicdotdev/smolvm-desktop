//! Fetch a smolfile from a URL and save it locally so it can be passed
//! to `smolvm machine create --smolfile <path>` / `smolvm pack create --smolfile <path>`.

use std::path::PathBuf;

/// Download a smolfile from a URL and save it under
/// `~/Documents/smolvm-smolfiles/`. GitHub `github.com/.../blob/...`
/// URLs are auto-rewritten to their `raw.githubusercontent.com` form.
/// Returns the local path written.
#[tauri::command]
pub async fn fetch_smolfile_from_url(url: String) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }
    let normalized = rewrite_github_blob(trimmed);

    let dir = smolfiles_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create smolfiles dir: {e}"))?;

    let filename = filename_from_url(&normalized);
    let dest = dir.join(filename);

    // Shell out to curl — universally available on macOS, follows redirects,
    // fails on non-2xx so we don't silently save an error page.
    let output = tokio::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "30", "-o"])
        .arg(&dest)
        .arg(&normalized)
        .output()
        .await
        .map_err(|e| format!("spawn curl: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "curl failed ({}): {}",
            output.status,
            stderr.trim()
        ));
    }

    Ok(dest.to_string_lossy().to_string())
}

fn smolfiles_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME not set".to_string())?;
    Ok(PathBuf::from(home)
        .join("Documents")
        .join("smolvm-smolfiles"))
}

/// Rewrite `https://github.com/<user>/<repo>/blob/<rest>` to the raw form.
/// Anything else passes through unchanged.
fn rewrite_github_blob(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://github.com/") {
        if let Some((repo, tail)) = rest.split_once("/blob/") {
            return format!("https://raw.githubusercontent.com/{repo}/{tail}");
        }
    }
    url.to_string()
}

fn filename_from_url(url: &str) -> String {
    let stripped = url.split(['?', '#']).next().unwrap_or(url);
    // Walk back to the first non-empty path segment so trailing slashes
    // don't make us fall back to the placeholder.
    let last = stripped
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or("smolfile");
    let safe: String = last
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() {
        "smolfile".to_string()
    } else {
        safe
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_github_blob() {
        assert_eq!(
            rewrite_github_blob(
                "https://github.com/smol-machines/smolvm/blob/main/examples/local-llm/local-llm.smolfile"
            ),
            "https://raw.githubusercontent.com/smol-machines/smolvm/main/examples/local-llm/local-llm.smolfile"
        );
    }

    #[test]
    fn passes_other_urls_through() {
        assert_eq!(
            rewrite_github_blob("https://example.com/foo.toml"),
            "https://example.com/foo.toml"
        );
    }

    #[test]
    fn filename_from_path() {
        assert_eq!(
            filename_from_url("https://example.com/a/b/c.smolfile"),
            "c.smolfile"
        );
        assert_eq!(filename_from_url("https://example.com/a/b/?ref=main"), "b");
    }
}
