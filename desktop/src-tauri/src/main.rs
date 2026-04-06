// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;

use db::connection::AppState;
use sqlx::sqlite::SqlitePoolOptions;
use std::fs;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            fs::create_dir_all(&app_dir).expect("Failed to create app data dir");

            let db_path = app_dir.join("nha_billing.db");
            let db_url = format!("sqlite://{}?mode=rwc", db_path.display());

            let pool = tauri::async_runtime::block_on(async {
                SqlitePoolOptions::new()
                    .max_connections(5)
                    .connect(&db_url)
                    .await
                    .expect("Failed to connect to database")
            });

            tauri::async_runtime::block_on(async {
                db::connection::run_migrations(&pool)
                    .await
                    .expect("Failed to run migrations");
                commands::auth::ensure_default_admin(&pool)
                    .await
                    .expect("Failed to ensure default admin user");
            });

            app.manage(AppState {
                db: tokio::sync::Mutex::new(pool),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::auth::login,
            commands::auth::logout,
            commands::auth::get_current_user,
            commands::auth::create_user,
            commands::auth::update_user,
            commands::auth::list_users,
            // Units
            commands::units::list_buildings,
            commands::units::create_building,
            commands::units::list_floors,
            commands::units::list_units,
            commands::units::get_unit,
            commands::units::find_unit_on_floor,
            commands::units::create_unit,
            commands::units::update_unit,
            commands::units::update_unit_status,
            commands::units::list_unit_documents,
            commands::units::attach_unit_document,
            commands::units::bulk_import_units,
            // Readings
            commands::readings::list_readings_for_cycle,
            commands::readings::approve_reading,
            commands::readings::flag_reading,
            commands::readings::manual_entry_reading,
            // Billing
            commands::billing::list_billing_cycles,
            commands::billing::create_billing_cycle,
            commands::billing::update_billing_cycle_status,
            commands::billing::delete_billing_cycle,
            commands::billing::generate_bills_for_cycle,
            commands::billing::get_bill,
            commands::billing::list_bills_for_account,
            commands::billing::list_bills_for_cycle,
            commands::billing::set_bldg_sub_reading,
            commands::billing::list_bldg_sub_readings_for_cycle,
            // Service actions
            commands::service_actions::list_service_cases,
            commands::service_actions::list_service_action_history,
            commands::service_actions::record_service_disconnection,
            commands::service_actions::record_service_reconnection,
            // Payments
            commands::payments::record_payment,
            commands::payments::get_payment,
            commands::payments::list_payments_for_bill,
            commands::payments::list_payments_for_receipt_group,
            commands::payments::void_payment,
            commands::payments::get_next_receipt_number,
            // Sync
            commands::sync::import_mobile_readings,
            commands::sync::export_reading_list,
            // Reports
            commands::reports::billing_summary,
            commands::reports::collection_summary,
            commands::reports::unpaid_accounts,
            commands::reports::aging_report,
            // Settings
            commands::settings::get_setting,
            commands::settings::update_setting,
            commands::settings::list_settings,
            // Backup
            commands::settings::backup_database,
            commands::settings::restore_database,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running NHA Water Billing application");
}
