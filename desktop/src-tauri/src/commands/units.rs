// src-tauri/src/commands/units.rs

use crate::commands::auth::require_role;
use crate::db::connection::{AppState, audit_log};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

// ── Buildings ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct BuildingRow {
    pub id: i64,
    pub name: String,
    pub code: String,
    pub total_floors: i64,
    pub sub_meter_number: Option<String>,
    pub notes: Option<String>,
    pub active_units: i64,
    pub total_units: i64,
}

#[tauri::command]
pub async fn list_buildings(state: State<'_, AppState>) -> Result<Vec<BuildingRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT b.id, b.name, b.code, b.total_floors, b.sub_meter_number, b.notes,
                COUNT(CASE WHEN u.status = 'active' THEN 1 END) as active_units,
                COUNT(u.id) as total_units
         FROM buildings b
         LEFT JOIN floors f ON f.building_id = b.id
         LEFT JOIN units u ON u.floor_id = f.id
         GROUP BY b.id
         ORDER BY b.code"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| BuildingRow {
        id: r.get("id"),
        name: r.get("name"),
        code: r.get("code"),
        total_floors: r.get("total_floors"),
        sub_meter_number: r.get("sub_meter_number"),
        notes: r.get("notes"),
        active_units: r.get("active_units"),
        total_units: r.get("total_units"),
    }).collect())
}

#[derive(Debug, Deserialize)]
pub struct CreateBuildingRequest {
    pub name: String,
    pub code: String,
    pub total_floors: i64,
    pub sub_meter_number: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn create_building(
    payload: CreateBuildingRequest,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    let id = sqlx::query(
        "INSERT INTO buildings (name, code, total_floors, sub_meter_number, notes)
         VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&payload.name)
    .bind(&payload.code)
    .bind(payload.total_floors)
    .bind(&payload.sub_meter_number)
    .bind(&payload.notes)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    // Auto-create floors
    for floor_num in 1..=payload.total_floors {
        sqlx::query("INSERT INTO floors (building_id, floor_number) VALUES (?, ?)")
            .bind(id)
            .bind(floor_num)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    audit_log(&pool, caller.id, "CREATE_BUILDING", "buildings", Some(id),
        &format!("Created building: {}", payload.code))
        .await.ok();

    Ok(id)
}

// ── Floors ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct FloorRow {
    pub id: i64,
    pub building_id: i64,
    pub floor_number: i64,
    pub active_units: i64,
    pub total_units: i64,
}

#[tauri::command]
pub async fn list_floors(
    building_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<FloorRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT f.id, f.building_id, f.floor_number,
                COUNT(CASE WHEN u.status = 'active' THEN 1 END) as active_units,
                COUNT(u.id) as total_units
         FROM floors f
         LEFT JOIN units u ON u.floor_id = f.id
         WHERE f.building_id = ?
         GROUP BY f.id
         ORDER BY f.floor_number"
    )
    .bind(building_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| FloorRow {
        id: r.get("id"),
        building_id: r.get("building_id"),
        floor_number: r.get("floor_number"),
        active_units: r.get("active_units"),
        total_units: r.get("total_units"),
    }).collect())
}

// ── Units ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct UnitRow {
    pub id: i64,
    pub building_id: i64,
    pub building_code: String,
    pub building_name: String,
    pub floor_id: i64,
    pub floor_number: i64,
    pub unit_number: String,
    pub meter_number: Option<String>,
    pub status: String,
    pub activated_at: Option<String>,
    pub deactivated_at: Option<String>,
    pub notes: Option<String>,
    // Account fields (joined)
    pub account_id: Option<i64>,
    pub account_number: Option<String>,
    pub resident_name: Option<String>,
    pub contact_number: Option<String>,
    pub outstanding_balance: Option<f64>,
}

#[tauri::command]
pub async fn list_units(
    floor_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<UnitRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT u.id, f.building_id, b.code as building_code, b.name as building_name,
                u.floor_id, f.floor_number, u.unit_number, u.meter_number, u.status,
                u.activated_at, u.deactivated_at, u.notes,
                a.id as account_id, a.account_number, a.resident_name,
                a.contact_number, a.outstanding_balance
         FROM units u
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.unit_id = u.id
         WHERE u.floor_id = ?
         ORDER BY u.unit_number"
    )
    .bind(floor_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| UnitRow {
        id: r.get("id"),
        building_id: r.get("building_id"),
        building_code: r.get("building_code"),
        building_name: r.get("building_name"),
        floor_id: r.get("floor_id"),
        floor_number: r.get("floor_number"),
        unit_number: r.get("unit_number"),
        meter_number: r.get("meter_number"),
        status: r.get("status"),
        activated_at: r.get("activated_at"),
        deactivated_at: r.get("deactivated_at"),
        notes: r.get("notes"),
        account_id: r.get("account_id"),
        account_number: r.get("account_number"),
        resident_name: r.get("resident_name"),
        contact_number: r.get("contact_number"),
        outstanding_balance: r.get("outstanding_balance"),
    }).collect())
}

#[tauri::command]
pub async fn get_unit(unit_id: i64, state: State<'_, AppState>) -> Result<UnitRow, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let r = sqlx::query(
        "SELECT u.id, f.building_id, b.code as building_code, b.name as building_name,
                u.floor_id, f.floor_number, u.unit_number, u.meter_number, u.status,
                u.activated_at, u.deactivated_at, u.notes,
                a.id as account_id, a.account_number, a.resident_name,
                a.contact_number, a.outstanding_balance
         FROM units u
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.unit_id = u.id
         WHERE u.id = ?"
    )
    .bind(unit_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(UnitRow {
        id: r.get("id"),
        building_id: r.get("building_id"),
        building_code: r.get("building_code"),
        building_name: r.get("building_name"),
        floor_id: r.get("floor_id"),
        floor_number: r.get("floor_number"),
        unit_number: r.get("unit_number"),
        meter_number: r.get("meter_number"),
        status: r.get("status"),
        activated_at: r.get("activated_at"),
        deactivated_at: r.get("deactivated_at"),
        notes: r.get("notes"),
        account_id: r.get("account_id"),
        account_number: r.get("account_number"),
        resident_name: r.get("resident_name"),
        contact_number: r.get("contact_number"),
        outstanding_balance: r.get("outstanding_balance"),
    })
}

#[derive(Debug, Deserialize)]
pub struct CreateUnitRequest {
    pub floor_id: i64,
    pub unit_number: String,
    pub meter_number: Option<String>,
    pub status: Option<String>,
    pub resident_name: Option<String>,
    pub contact_number: Option<String>,
    pub account_number: Option<String>,
}

#[tauri::command]
pub async fn create_unit(
    payload: CreateUnitRequest,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    let status = payload.status.as_deref().unwrap_or("active");

    let unit_id = sqlx::query(
        "INSERT INTO units (floor_id, unit_number, meter_number, status, activated_at)
         VALUES (?, ?, ?, ?, CASE WHEN ? = 'active' THEN datetime('now') ELSE NULL END)"
    )
    .bind(payload.floor_id)
    .bind(&payload.unit_number)
    .bind(&payload.meter_number)
    .bind(status)
    .bind(status)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    // Create account if resident info provided
    if let Some(name) = &payload.resident_name {
        let acct_num = payload.account_number.clone().unwrap_or_else(|| {
            format!("ACC-{:07}", unit_id)
        });
        sqlx::query(
            "INSERT INTO accounts (unit_id, account_number, resident_name, contact_number)
             VALUES (?, ?, ?, ?)"
        )
        .bind(unit_id)
        .bind(&acct_num)
        .bind(name)
        .bind(&payload.contact_number)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    audit_log(&pool, caller.id, "CREATE_UNIT", "units", Some(unit_id),
        &format!("Unit {} created", payload.unit_number))
        .await.ok();

    Ok(unit_id)
}

#[derive(Debug, Deserialize)]
pub struct UpdateUnitRequest {
    pub id: i64,
    pub meter_number: Option<String>,
    pub notes: Option<String>,
    pub resident_name: Option<String>,
    pub contact_number: Option<String>,
}

#[tauri::command]
pub async fn update_unit(
    payload: UpdateUnitRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    sqlx::query("UPDATE units SET meter_number = ? WHERE id = ?")
        .bind(payload.meter_number.as_deref())
        .bind(payload.id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(n) = &payload.notes {
        sqlx::query("UPDATE units SET notes = ? WHERE id = ?")
            .bind(n).bind(payload.id)
            .execute(&*pool).await.map_err(|e| e.to_string())?;
    }
    if let Some(name) = &payload.resident_name {
        sqlx::query(
            "UPDATE accounts SET resident_name = ?, contact_number = ?
             WHERE unit_id = ?"
        )
        .bind(name)
        .bind(&payload.contact_number)
        .bind(payload.id)
        .execute(&*pool).await.map_err(|e| e.to_string())?;
    }

    audit_log(&pool, caller.id, "UPDATE_UNIT", "units", Some(payload.id), "Unit updated")
        .await.ok();
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct UpdateStatusRequest {
    pub unit_id: i64,
    pub status: String,
}

#[tauri::command]
pub async fn update_unit_status(
    payload: UpdateStatusRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    sqlx::query(
        "UPDATE units SET status = ?,
         activated_at = CASE WHEN ? = 'active' THEN datetime('now') ELSE activated_at END,
         deactivated_at = CASE WHEN ? != 'active' THEN datetime('now') ELSE NULL END
         WHERE id = ?"
    )
    .bind(&payload.status)
    .bind(&payload.status)
    .bind(&payload.status)
    .bind(payload.unit_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    audit_log(&pool, caller.id, "UPDATE_UNIT_STATUS", "units", Some(payload.unit_id),
        &format!("Status changed to {}", payload.status))
        .await.ok();
    Ok(())
}

// ── Bulk Import ───────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct BulkImportResult {
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// CSV format: building_code,floor_number,unit_number,meter_number,status,resident_name,contact,account_number
#[tauri::command]
pub async fn bulk_import_units(
    csv_path: String,
    state: State<'_, AppState>,
) -> Result<BulkImportResult, String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    let content = std::fs::read_to_string(&csv_path).map_err(|e| e.to_string())?;
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(content.as_bytes());

    let mut result = BulkImportResult {
        total: 0, imported: 0, skipped: 0, errors: vec![],
    };

    for (line, record) in rdr.records().enumerate() {
        result.total += 1;
        let line = line + 2; // 1-indexed + header

        let record = match record {
            Ok(r) => r,
            Err(e) => {
                result.errors.push(format!("Line {}: {}", line, e));
                result.skipped += 1;
                continue;
            }
        };

        let building_code = record.get(0).unwrap_or("").trim().to_string();
        let floor_number: i64 = match record.get(1).unwrap_or("").trim().parse() {
            Ok(n) => n,
            Err(_) => {
                result.errors.push(format!("Line {}: invalid floor number", line));
                result.skipped += 1;
                continue;
            }
        };
        let unit_number = record.get(2).unwrap_or("").trim().to_string();
        let meter_number = record.get(3).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let status = record.get(4).unwrap_or("active").trim().to_string();
        let resident_name = record.get(5).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let contact = record.get(6).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let account_number = record.get(7).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

        if building_code.is_empty() || unit_number.is_empty() {
            result.errors.push(format!("Line {}: missing building_code or unit_number", line));
            result.skipped += 1;
            continue;
        }

        // Resolve floor ID
        let floor_id: Option<i64> = sqlx::query_scalar(
            "SELECT f.id FROM floors f
             JOIN buildings b ON b.id = f.building_id
             WHERE b.code = ? AND f.floor_number = ?"
        )
        .bind(&building_code)
        .bind(floor_number)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| e.to_string())?;

        let floor_id = match floor_id {
            Some(id) => id,
            None => {
                result.errors.push(format!(
                    "Line {}: building {} floor {} not found", line, building_code, floor_number
                ));
                result.skipped += 1;
                continue;
            }
        };

        // Check duplicate
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM units WHERE floor_id = ? AND unit_number = ?"
        )
        .bind(floor_id)
        .bind(&unit_number)
        .fetch_one(&*pool)
        .await
        .map_err(|e| e.to_string())?;

        if exists > 0 {
            result.skipped += 1;
            continue;
        }

        let unit_id = sqlx::query(
            "INSERT INTO units (floor_id, unit_number, meter_number, status,
             activated_at) VALUES (?, ?, ?, ?, CASE WHEN ? = 'active' THEN datetime('now') ELSE NULL END)"
        )
        .bind(floor_id)
        .bind(&unit_number)
        .bind(&meter_number)
        .bind(&status)
        .bind(&status)
        .execute(&*pool)
        .await
        .map_err(|e| {
            result.errors.push(format!("Line {}: {}", line, e));
            e.to_string()
        })
        .map(|r| r.last_insert_rowid())
        .unwrap_or(0);

        if unit_id > 0 {
            if let Some(name) = &resident_name {
                let acct = account_number.clone().unwrap_or_else(|| format!("ACC-{:07}", unit_id));
                sqlx::query(
                    "INSERT INTO accounts (unit_id, account_number, resident_name, contact_number)
                     VALUES (?, ?, ?, ?)"
                )
                .bind(unit_id).bind(&acct).bind(name).bind(&contact)
                .execute(&*pool).await.ok();
            }
            result.imported += 1;
        }
    }

    audit_log(&pool, caller.id, "BULK_IMPORT", "units", None,
        &format!("Imported {} of {} units", result.imported, result.total))
        .await.ok();

    Ok(result)
}
