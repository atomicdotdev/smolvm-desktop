mod commands;
mod smolvm;
mod tray;
mod types;

use tauri::WindowEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            tray::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::machines::list_machines,
            commands::machines::start_machine,
            commands::machines::stop_machine,
            commands::machines::delete_machine,
            commands::machines::inspect_machine,
            commands::machines::create_machine,
            commands::machines::run_machine,
            commands::exec::exec_start,
            commands::exec::exec_write,
            commands::exec::exec_resize,
            commands::exec::exec_stop,
            commands::images::list_images,
            commands::stats::machine_stats,
            commands::stats::system_stats,
            commands::tasks::run_task,
            commands::tasks::stop_task,
            commands::files::list_files,
            commands::files::read_file,
            commands::files::write_file,
            commands::files::upload_file,
            commands::files::download_file,
            commands::logs::machine_data_dir,
            commands::logs::machine_log_snapshot,
            commands::logs::machine_log_follow,
            commands::logs::machine_log_stop,
            commands::system::smolvm_health,
            commands::system::system_info,
            commands::system::set_smolvm_binary,
            commands::system::get_smolvm_binary,
            commands::config::smolvm_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
