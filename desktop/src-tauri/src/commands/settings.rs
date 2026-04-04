use crate::commands::auth::require_role;
use crate::db::connection::{audit_log, get_setting as fetch_setting, set_setting, AppState};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::path::Path;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
    pub description: Option<String>,
}

#[tauri::command]
pub async fn get_setting(key: String, state: State<'_, AppState>) -> Result<String, String> {
    require_role(&["admin"])?;
    let pool = state.db.lock().await;
    fetch_setting(&pool, &key).await.map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingRequest {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub async fn update_setting(
    payload: UpdateSettingRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    set_setting(&pool, &payload.key, &payload.value, Some(caller.id))
        .await
        .map_err(|e| e.to_string())?;

    audit_log(
        &pool,
        caller.id,
        "UPDATE_SETTING",
        "system_settings",
        None,
        &format!("{}={}", payload.key, payload.value),
    )
    .await
    .ok();

    Ok(())
}

#[tauri::command]
pub async fn list_settings(state: State<'_, AppState>) -> Result<Vec<SettingRow>, String> {
    require_role(&["admin"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT key, value, description
         FROM system_settings
         ORDER BY key"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| SettingRow {
            key: r.get("key"),
            value: r.get("value"),
            description: r.get("description"),
        })
        .collect())
}

#[tauri::command]
pub async fn backup_database(
    backup_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    if Path::new(&backup_path).exists() {
        std::fs::remove_file(&backup_path).map_err(|e| e.to_string())?;
    }

    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    let escaped_path = backup_path.replace('\'', "''");
    sqlx::query(&format!("VACUUM INTO '{}'", escaped_path))
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    audit_log(
        &pool,
        caller.id,
        "BACKUP_DATABASE",
        "system_settings",
        None,
        &format!("Backup created at {}", backup_path),
    )
    .await
    .ok();

    Ok(())
}

#[tauri::command]
pub async fn restore_database(
    backup_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin"])?;
    if !Path::new(&backup_path).exists() {
        return Err("Backup file not found.".to_string());
    }

    let pool = state.db.lock().await;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let escaped_path = backup_path.replace('\'', "''");

    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query(&format!("ATTACH DATABASE '{}' AS restore_db", escaped_path))
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let delete_order = [
        "payments",
        "bills",
        "meter_readings",
        "bldg_sub_readings",
        "accounts",
        "units",
        "floors",
        "buildings",
        "billing_cycles",
        "audit_logs",
        "system_settings",
        "users",
    ];

    for table in delete_order {
        sqlx::query(&format!("DELETE FROM {}", table))
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }

    let insert_order = [
        "users",
        "buildings",
        "floors",
        "units",
        "accounts",
        "billing_cycles",
        "bldg_sub_readings",
        "meter_readings",
        "bills",
        "payments",
        "audit_logs",
        "system_settings",
    ];

    for table in insert_order {
        sqlx::query(&format!("INSERT INTO main.{0} SELECT * FROM restore_db.{0}", table))
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }

    sqlx::query("DELETE FROM sqlite_sequence")
        .execute(&mut *conn)
        .await
        .ok();
    sqlx::query("INSERT INTO sqlite_sequence SELECT * FROM restore_db.sqlite_sequence")
        .execute(&mut *conn)
        .await
        .ok();

    sqlx::query("DETACH DATABASE restore_db")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    audit_log(
        &pool,
        caller.id,
        "RESTORE_DATABASE",
        "system_settings",
        None,
        &format!("Database restored from {}", backup_path),
    )
    .await
    .ok();

    Ok(())
}
