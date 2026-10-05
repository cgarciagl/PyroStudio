pub mod db;
pub mod excel;

use db::DbState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_state = DbState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(db_state)
        .invoke_handler(tauri::generate_handler![
            db::save_credential,
            db::get_credential,
            db::has_credential,
            db::delete_credential,
            db::test_connection,
            db::connect_db,
            db::disconnect_db,
            db::get_connection_status,
            db::list_databases,
            db::list_tables,
            db::get_table_columns,
            db::get_table_primary_key,
            db::drop_table,
            db::truncate_table,
            db::query_table_data,
            db::update_cell,
            db::delete_row,
            db::execute_query,
            db::list_routines,
            db::get_routine_definition,
            db::list_triggers,
            db::get_trigger_definition,
            db::drop_routine,
            db::drop_trigger,
            db::save_routine,
            db::save_trigger,
            db::execute_routine,
            db::list_indexes,
            db::create_index,
            db::drop_index,
            db::check_sql_safety,
            excel::pick_excel_file,
            excel::save_excel_dialog,
            excel::preview_excel_file,
            excel::import_excel_file,
            excel::export_excel_file,
            excel::export_dataset_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pyro Studio tauri application");
}
