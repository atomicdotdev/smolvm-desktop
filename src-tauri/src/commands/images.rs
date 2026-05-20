//! Derived "image catalog" view.
//!
//! smolvm has no standalone image store — OCI layers live inside each machine's
//! storage.raw disk. The closest thing we can offer is a grouping of machines
//! by their source image reference.

use serde::{Deserialize, Serialize};

use crate::commands::machines::list_machines;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSummary {
    pub reference: String,
    pub machines: Vec<String>,
    pub running_count: usize,
}

#[tauri::command]
pub async fn list_images() -> Result<Vec<ImageSummary>, String> {
    let machines = list_machines().await?;
    let mut by_ref: std::collections::BTreeMap<String, ImageSummary> =
        std::collections::BTreeMap::new();

    for m in machines {
        let reference = match m.image.clone() {
            Some(r) if !r.is_empty() => r,
            _ => continue, // bare-VM machines have no image to catalog
        };
        let is_running = matches!(
            m.status,
            crate::types::MachineStatus::Running | crate::types::MachineStatus::Starting
        );
        by_ref
            .entry(reference.clone())
            .and_modify(|e| {
                e.machines.push(m.name.clone());
                if is_running {
                    e.running_count += 1;
                }
            })
            .or_insert_with(|| ImageSummary {
                reference,
                machines: vec![m.name.clone()],
                running_count: if is_running { 1 } else { 0 },
            });
    }

    Ok(by_ref.into_values().collect())
}
