//! Hand-written TOML generator for the create-time policy Smolfile.
//!
//! We emit a *policy-only* Smolfile (just `[restart]` and `[health]`) so it
//! composes additively with the existing `--image / --cpus / -v / -p / ...`
//! CLI flags. Anything we put in the Smolfile would override the matching
//! CLI flag — so we deliberately keep this blob minimal.
//!
//! Schema reference (smolvm 0.7.2, `src/cli/smolfile.rs:208-272`):
//! ```toml
//! [health]
//! exec          = ["sh", "-c", "<cmd>"]
//! interval      = "10s"
//! timeout       = "2s"
//! retries       = 3
//! startup_grace = "20s"
//!
//! [restart]
//! policy        = "never" | "always" | "on-failure" | "unless-stopped"
//! max_retries   = 5
//! max_backoff   = "30s"
//! ```

use crate::types::{HealthSpec, RestartSpec};

/// Build the policy-only Smolfile TOML. Returns `None` if neither section
/// has anything to emit (in which case the caller should *not* pass
/// `--smolfile`, to avoid overriding CLI flags with an empty blob).
pub fn to_policy_smolfile(
    restart: Option<&RestartSpec>,
    health: Option<&HealthSpec>,
) -> Option<String> {
    let restart_block = restart.map(render_restart);
    let health_block = health.and_then(render_health);

    if restart_block.is_none() && health_block.is_none() {
        return None;
    }

    let mut out = String::new();
    if let Some(s) = health_block {
        out.push_str(&s);
    }
    if let Some(s) = restart_block {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&s);
    }
    Some(out)
}

fn render_restart(r: &RestartSpec) -> String {
    let mut s = String::from("[restart]\n");
    s.push_str(&format!(
        "policy = \"{}\"\n",
        r.policy.as_smolfile_str()
    ));
    if let Some(n) = r.max_retries {
        s.push_str(&format!("max_retries = {n}\n"));
    }
    if let Some(secs) = r.max_backoff_secs {
        s.push_str(&format!("max_backoff = \"{secs}s\"\n"));
    }
    s
}

/// Render the `[health]` section. Returns `None` when `exec` is empty —
/// without a command there's nothing meaningful to check, and emitting an
/// empty `exec = []` would be rejected by smolvm.
fn render_health(h: &HealthSpec) -> Option<String> {
    let exec: Vec<&str> = h
        .exec
        .iter()
        .map(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .collect();
    if exec.is_empty() {
        return None;
    }

    let mut s = String::from("[health]\n");
    s.push_str("exec = [");
    for (i, part) in exec.iter().enumerate() {
        if i > 0 {
            s.push_str(", ");
        }
        s.push_str(&quote_toml_string(part));
    }
    s.push_str("]\n");

    if let Some(secs) = h.interval_secs {
        s.push_str(&format!("interval = \"{secs}s\"\n"));
    }
    if let Some(secs) = h.timeout_secs {
        s.push_str(&format!("timeout = \"{secs}s\"\n"));
    }
    if let Some(n) = h.retries {
        s.push_str(&format!("retries = {n}\n"));
    }
    if let Some(secs) = h.startup_grace_secs {
        s.push_str(&format!("startup_grace = \"{secs}s\"\n"));
    }
    Some(s)
}

/// TOML basic-string quoting. Escapes `\`, `"`, and the control chars TOML
/// requires escaped (newline, carriage return, tab, backspace, form feed).
/// Anything else printable (including spaces, quotes-already-escaped, etc.)
/// passes through.
fn quote_toml_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04X}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RestartPolicy;

    #[test]
    fn nothing_set_returns_none() {
        assert!(to_policy_smolfile(None, None).is_none());
    }

    #[test]
    fn health_with_empty_exec_is_skipped() {
        let h = HealthSpec {
            exec: vec![],
            interval_secs: Some(10),
            timeout_secs: None,
            retries: None,
            startup_grace_secs: None,
        };
        // Health is empty AND restart is missing → entire smolfile is None.
        assert!(to_policy_smolfile(None, Some(&h)).is_none());
    }

    #[test]
    fn restart_only_minimal() {
        let r = RestartSpec {
            policy: RestartPolicy::Always,
            max_retries: None,
            max_backoff_secs: None,
        };
        let out = to_policy_smolfile(Some(&r), None).unwrap();
        assert_eq!(out, "[restart]\npolicy = \"always\"\n");
    }

    #[test]
    fn restart_full() {
        let r = RestartSpec {
            policy: RestartPolicy::OnFailure,
            max_retries: Some(5),
            max_backoff_secs: Some(30),
        };
        let out = to_policy_smolfile(Some(&r), None).unwrap();
        assert_eq!(
            out,
            "[restart]\n\
             policy = \"on-failure\"\n\
             max_retries = 5\n\
             max_backoff = \"30s\"\n"
        );
    }

    #[test]
    fn health_full_with_shell_wrap() {
        let h = HealthSpec {
            exec: vec!["sh".into(), "-c".into(), "curl -f localhost:8080".into()],
            interval_secs: Some(10),
            timeout_secs: Some(2),
            retries: Some(3),
            startup_grace_secs: Some(20),
        };
        let out = to_policy_smolfile(None, Some(&h)).unwrap();
        assert_eq!(
            out,
            "[health]\n\
             exec = [\"sh\", \"-c\", \"curl -f localhost:8080\"]\n\
             interval = \"10s\"\n\
             timeout = \"2s\"\n\
             retries = 3\n\
             startup_grace = \"20s\"\n"
        );
    }

    #[test]
    fn both_sections_health_first_then_restart_separated_by_blank_line() {
        let r = RestartSpec {
            policy: RestartPolicy::UnlessStopped,
            max_retries: Some(0),
            max_backoff_secs: None,
        };
        let h = HealthSpec {
            exec: vec!["echo".into(), "ok".into()],
            interval_secs: Some(2),
            timeout_secs: None,
            retries: None,
            startup_grace_secs: None,
        };
        let out = to_policy_smolfile(Some(&r), Some(&h)).unwrap();
        assert_eq!(
            out,
            "[health]\n\
             exec = [\"echo\", \"ok\"]\n\
             interval = \"2s\"\n\
             \n\
             [restart]\n\
             policy = \"unless-stopped\"\n\
             max_retries = 0\n"
        );
    }

    #[test]
    fn escapes_double_quotes_and_backslashes_in_command() {
        let h = HealthSpec {
            exec: vec![
                "sh".into(),
                "-c".into(),
                r#"echo "hello" && grep \w /tmp/x"#.into(),
            ],
            interval_secs: None,
            timeout_secs: None,
            retries: None,
            startup_grace_secs: None,
        };
        let out = to_policy_smolfile(None, Some(&h)).unwrap();
        // Inside a TOML basic string, " → \"  and  \ → \\.
        assert_eq!(
            out,
            "[health]\nexec = [\"sh\", \"-c\", \"echo \\\"hello\\\" && grep \\\\w /tmp/x\"]\n"
        );
    }

    #[test]
    fn escapes_control_chars_in_command() {
        let h = HealthSpec {
            exec: vec!["sh".into(), "-c".into(), "a\nb\tc".into()],
            interval_secs: None,
            timeout_secs: None,
            retries: None,
            startup_grace_secs: None,
        };
        let out = to_policy_smolfile(None, Some(&h)).unwrap();
        assert_eq!(
            out,
            "[health]\nexec = [\"sh\", \"-c\", \"a\\nb\\tc\"]\n"
        );
    }

    #[test]
    fn skips_empty_exec_parts() {
        let h = HealthSpec {
            exec: vec!["sh".into(), "".into(), "-c".into(), "ok".into()],
            interval_secs: None,
            timeout_secs: None,
            retries: None,
            startup_grace_secs: None,
        };
        let out = to_policy_smolfile(None, Some(&h)).unwrap();
        assert_eq!(out, "[health]\nexec = [\"sh\", \"-c\", \"ok\"]\n");
    }
}
