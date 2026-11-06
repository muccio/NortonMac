pub mod archive_vfs;
pub mod commands;
pub mod importers;
pub mod local_fs;
pub mod models;
pub mod remote_fs;
pub mod site_manager;

use commands::AppState;
use remote_fs::RemoteManager;
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let remote_manager = Arc::new(RemoteManager::new());

    tauri::Builder::default()
        .manage(AppState {
            remote_manager: remote_manager.clone(),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut prev_signature = String::new();
                loop {
                    let vols = local_fs::get_all_volumes();
                    let signature = vols
                        .iter()
                        .map(|v| format!("{}@{}", v.name, v.mount_point))
                        .collect::<Vec<_>>()
                        .join("|");

                    if signature != prev_signature {
                        prev_signature = signature;
                        let _ = handle.emit("volumes-changed", &vols);
                    }
                    std::thread::sleep(Duration::from_millis(1200));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_home_directory,
            commands::get_volumes,
            commands::list_directory,
            commands::read_file_preview,
            commands::save_file_content,
            commands::open_file_native,
            commands::create_directory,
            commands::delete_items,
            commands::copy_items,
            commands::move_items,
            commands::duplicate_items,
            commands::create_archive,
            commands::execute_shell_command,
            commands::get_saved_sites,
            commands::save_site_config,
            commands::delete_site_config,
            commands::connect_site,
            commands::detect_external_sites,
            commands::parse_imported_sites,
            commands::import_sites_batch,
            commands::export_sites_to_json,
            commands::calculate_item_size,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
