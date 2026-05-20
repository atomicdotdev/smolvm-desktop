use crate::commands;
use crate::types::MachineStatus;
use tauri::{
    include_image,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

// TODO: replace with real docs URL once available.
const DOCS_URL: &str = "https://github.com/atomic-dev/smolvm";

const TRAY_ID: &str = "main";
const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10);

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, false, &[])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(include_image!("icons/tray-icon-64.png"))
        .icon_as_template(true)
        .tooltip("SmolVM Desktop")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(handle_menu_event)
        .build(app)?;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = refresh_menu(&app_handle).await {
                eprintln!("tray refresh failed: {e}");
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });

    Ok(())
}

async fn refresh_menu(app: &AppHandle) -> tauri::Result<()> {
    let healthy = commands::system::smolvm_health()
        .await
        .map(|h| h.healthy)
        .unwrap_or(false);

    let machines: Vec<(String, MachineStatus)> = if healthy {
        commands::machines::list_machines()
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|m| (m.name, m.status))
            .collect()
    } else {
        Vec::new()
    };

    let menu = build_menu(app, healthy, &machines)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

fn build_menu(
    app: &AppHandle,
    healthy: bool,
    machines: &[(String, MachineStatus)],
) -> tauri::Result<Menu<Wry>> {
    let status_text = if healthy {
        "● SmolVM is running"
    } else {
        "○ smolvm not detected"
    };
    let status = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;

    let open = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
    let new_machine = MenuItem::with_id(app, "new_machine", "New Machine…", true, None::<&str>)?;

    let machines_submenu = Submenu::with_id(app, "machines_submenu", "Machines", true)?;
    if machines.is_empty() {
        let none = MenuItem::with_id(app, "machines_none", "No machines", false, None::<&str>)?;
        machines_submenu.append(&none)?;
    } else {
        const TABS: &[(&str, &str)] = &[
            ("logs", "Logs"),
            ("inspect", "Inspect"),
            ("exec", "Exec"),
            ("run", "Run"),
            ("files", "Files"),
            ("ports", "Ports"),
            ("stats", "Stats"),
        ];
        for (name, status) in machines {
            let is_running =
                matches!(status, MachineStatus::Running | MachineStatus::Starting);
            let dot = if is_running { "●" } else { "○" };
            let machine_menu = Submenu::with_id(
                app,
                format!("machine_menu:{name}"),
                format!("{dot} {name}"),
                true,
            )?;
            for (tab_id, tab_label) in TABS {
                let item = MenuItem::with_id(
                    app,
                    format!("machine:tab:{tab_id}:{name}"),
                    tab_label,
                    true,
                    None::<&str>,
                )?;
                machine_menu.append(&item)?;
            }
            machine_menu.append(&PredefinedMenuItem::separator(app)?)?;
            let action = if is_running {
                MenuItem::with_id(
                    app,
                    format!("machine:stop:{name}"),
                    "Stop",
                    true,
                    None::<&str>,
                )?
            } else {
                MenuItem::with_id(
                    app,
                    format!("machine:start:{name}"),
                    "Start",
                    true,
                    None::<&str>,
                )?
            };
            machine_menu.append(&action)?;
            machines_submenu.append(&machine_menu)?;
        }
    }

    let images = MenuItem::with_id(app, "nav:images", "Images", true, None::<&str>)?;
    let volumes = MenuItem::with_id(app, "nav:volumes", "Volumes", true, None::<&str>)?;
    let docs = MenuItem::with_id(app, "docs", "Documentation", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "About SmolVM Desktop", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &new_machine,
            &machines_submenu,
            &PredefinedMenuItem::separator(app)?,
            &images,
            &volumes,
            &PredefinedMenuItem::separator(app)?,
            &docs,
            &about,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id.as_ref();
    match id {
        "open" => show_main_window(app),
        "new_machine" => {
            show_main_window(app);
            let _ = app.emit("tray:new-machine", ());
        }
        "nav:images" => {
            show_main_window(app);
            let _ = app.emit("tray:navigate", "images");
        }
        "nav:volumes" => {
            show_main_window(app);
            let _ = app.emit("tray:navigate", "volumes");
        }
        "docs" => open_url(DOCS_URL),
        "about" => show_about(app),
        "quit" => app.exit(0),
        other => {
            if let Some(name) = other.strip_prefix("machine:focus:") {
                show_main_window(app);
                let _ = app.emit(
                    "tray:focus-machine",
                    serde_json::json!({ "name": name }),
                );
            } else if let Some(rest) = other.strip_prefix("machine:tab:") {
                if let Some((tab, name)) = rest.split_once(':') {
                    show_main_window(app);
                    let _ = app.emit(
                        "tray:focus-machine",
                        serde_json::json!({ "name": name, "tab": tab }),
                    );
                }
            } else if let Some(name) = other.strip_prefix("machine:stop:") {
                let name = name.to_string();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = commands::machines::stop_machine(name).await;
                    let _ = refresh_menu(&app).await;
                });
            } else if let Some(name) = other.strip_prefix("machine:start:") {
                let name = name.to_string();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = commands::machines::start_machine(name).await;
                    let _ = refresh_menu(&app).await;
                });
            }
        }
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn show_about(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    app.dialog()
        .message(format!(
            "SmolVM Desktop v{version}\nLocal VM management UI"
        ))
        .title("About SmolVM Desktop")
        .kind(MessageDialogKind::Info)
        .show(|_| {});
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) {
    let _ = std::process::Command::new("open").arg(url).spawn();
}

#[cfg(target_os = "linux")]
fn open_url(url: &str) {
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

#[cfg(target_os = "windows")]
fn open_url(url: &str) {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
}
