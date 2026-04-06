// src-tauri/src/commands/units.rs

use crate::commands::auth::require_role;
use crate::db::connection::{AppState, audit_log};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

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

#[derive(Debug, Serialize)]
pub struct UnitDocumentRow {
    pub id: i64,
    pub unit_id: i64,
    pub document_type: String,
    pub original_name: String,
    pub stored_path: String,
    pub notes: Option<String>,
    pub uploaded_at: String,
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
    let unit_number = payload.unit_number.trim().to_string();
    let meter_number = payload
        .meter_number
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if unit_number.is_empty() {
        return Err("Unit number is required.".to_string());
    }

    let existing_unit_id: Option<i64> =
        sqlx::query_scalar("SELECT id FROM units WHERE floor_id = ? AND unit_number = ?")
            .bind(payload.floor_id)
            .bind(&unit_number)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| e.to_string())?;

    if existing_unit_id.is_some() {
        return Err(format!(
            "Unit {} already exists on this floor. Open the existing unit record instead of creating a duplicate.",
            unit_number
        ));
    }

    if let Some(ref meter) = meter_number {
        let existing_meter_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM units WHERE meter_number = ?")
                .bind(meter)
                .fetch_optional(&*pool)
                .await
                .map_err(|e| e.to_string())?;

        if existing_meter_id.is_some() {
            return Err("This meter number is already assigned to another unit.".to_string());
        }
    }

    let unit_id = sqlx::query(
        "INSERT INTO units (floor_id, unit_number, meter_number, status, activated_at)
         VALUES (?, ?, ?, ?, CASE WHEN ? = 'active' THEN datetime('now') ELSE NULL END)"
    )
    .bind(payload.floor_id)
    .bind(&unit_number)
    .bind(&meter_number)
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
        &format!("Unit {} created", unit_number))
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
    pub account_number: Option<String>,
}

#[tauri::command]
pub async fn update_unit(
    payload: UpdateUnitRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    let meter_number = payload
        .meter_number
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let notes = payload
        .notes
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let resident_name = payload
        .resident_name
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let contact_number = payload
        .contact_number
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let account_number = payload
        .account_number
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(ref meter) = meter_number {
        let meter_conflict: Option<i64> =
            sqlx::query_scalar("SELECT id FROM units WHERE meter_number = ? AND id != ?")
                .bind(meter)
                .bind(payload.id)
                .fetch_optional(&*pool)
                .await
                .map_err(|e| e.to_string())?;

        if meter_conflict.is_some() {
            return Err("This meter number is already assigned to another unit.".to_string());
        }
    }

    sqlx::query("UPDATE units SET meter_number = ? WHERE id = ?")
        .bind(meter_number.as_deref())
        .bind(payload.id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(n) = &notes {
        sqlx::query("UPDATE units SET notes = ? WHERE id = ?")
            .bind(n).bind(payload.id)
            .execute(&*pool).await.map_err(|e| e.to_string())?;
    }

    if let Some(name) = &resident_name {
        let existing_account_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM accounts WHERE unit_id = ?")
                .bind(payload.id)
                .fetch_optional(&*pool)
                .await
                .map_err(|e| e.to_string())?;

        if let Some(account_id) = existing_account_id {
            if let Some(ref account_number_value) = account_number {
                let account_conflict: Option<i64> =
                    sqlx::query_scalar(
                        "SELECT id FROM accounts WHERE account_number = ? AND id != ?"
                    )
                    .bind(account_number_value)
                    .bind(account_id)
                    .fetch_optional(&*pool)
                    .await
                    .map_err(|e| e.to_string())?;

                if account_conflict.is_some() {
                    return Err(
                        "This account number is already assigned to another tenant.".to_string()
                    );
                }
            }

            sqlx::query(
                "UPDATE accounts
                 SET resident_name = ?, contact_number = ?, account_number = COALESCE(?, account_number)
                 WHERE unit_id = ?"
            )
            .bind(name)
            .bind(contact_number.as_deref())
            .bind(account_number.as_deref())
            .bind(payload.id)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
        } else {
            let new_account_number =
                account_number.unwrap_or_else(|| format!("ACC-{:07}", payload.id));

            let account_conflict: Option<i64> =
                sqlx::query_scalar("SELECT id FROM accounts WHERE account_number = ?")
                    .bind(&new_account_number)
                    .fetch_optional(&*pool)
                    .await
                    .map_err(|e| e.to_string())?;

            if account_conflict.is_some() {
                return Err(
                    "This account number is already assigned to another tenant.".to_string()
                );
            }

            sqlx::query(
                "INSERT INTO accounts (unit_id, account_number, resident_name, contact_number)
                 VALUES (?, ?, ?, ?)"
            )
            .bind(payload.id)
            .bind(&new_account_number)
            .bind(name)
            .bind(contact_number.as_deref())
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;

            sqlx::query(
                "UPDATE units
                 SET status = CASE WHEN status = 'vacant' THEN 'active' ELSE status END,
                     activated_at = CASE WHEN status = 'vacant' THEN datetime('now') ELSE activated_at END
                 WHERE id = ?"
            )
            .bind(payload.id)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
        }
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

#[derive(Debug, Deserialize)]
pub struct AttachUnitDocumentRequest {
    pub unit_id: i64,
    pub source_path: String,
    pub document_type: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn list_unit_documents(
    unit_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<UnitDocumentRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT id, unit_id, document_type, original_name, stored_path, notes, uploaded_at
         FROM unit_documents
         WHERE unit_id = ?
         ORDER BY uploaded_at DESC, id DESC"
    )
    .bind(unit_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| UnitDocumentRow {
            id: row.get("id"),
            unit_id: row.get("unit_id"),
            document_type: row.get("document_type"),
            original_name: row.get("original_name"),
            stored_path: row.get("stored_path"),
            notes: row.get("notes"),
            uploaded_at: row.get("uploaded_at"),
        })
        .collect())
}

#[tauri::command]
pub async fn attach_unit_document(
    payload: AttachUnitDocumentRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UnitDocumentRow, String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    let source_path = payload.source_path.trim();
    if source_path.is_empty() {
        return Err("Choose a document file first.".to_string());
    }

    let unit_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM units WHERE id = ?")
        .bind(payload.unit_id)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    if unit_exists.is_none() {
        return Err("Unit record not found.".to_string());
    }

    let source = Path::new(source_path);
    if !source.exists() {
        return Err("The selected document file could not be found.".to_string());
    }

    let document_type = payload.document_type.trim().to_string();
    if document_type.is_empty() {
        return Err("Document type is required.".to_string());
    }

    let notes = payload
        .notes
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let docs_dir = app_dir
        .join("unit-documents")
        .join(format!("unit-{}", payload.unit_id));
    fs::create_dir_all(&docs_dir).map_err(|e| e.to_string())?;

    let original_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_string();
    let safe_name = sanitize_file_name(&original_name);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let stored_path = docs_dir.join(format!("{}_{}", stamp, safe_name));

    fs::copy(source, &stored_path).map_err(|e| e.to_string())?;

    let document_id = sqlx::query(
        "INSERT INTO unit_documents (unit_id, document_type, original_name, stored_path, notes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(payload.unit_id)
    .bind(&document_type)
    .bind(&original_name)
    .bind(stored_path.to_string_lossy().to_string())
    .bind(notes.as_deref())
    .bind(caller.id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    audit_log(
        &pool,
        caller.id,
        "ATTACH_UNIT_DOCUMENT",
        "unit_documents",
        Some(document_id),
        &format!("Attached {} to unit {}", document_type, payload.unit_id),
    )
    .await
    .ok();

    let row = sqlx::query(
        "SELECT id, unit_id, document_type, original_name, stored_path, notes, uploaded_at
         FROM unit_documents
         WHERE id = ?"
    )
    .bind(document_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(UnitDocumentRow {
        id: row.get("id"),
        unit_id: row.get("unit_id"),
        document_type: row.get("document_type"),
        original_name: row.get("original_name"),
        stored_path: row.get("stored_path"),
        notes: row.get("notes"),
        uploaded_at: row.get("uploaded_at"),
    })
}

#[derive(Debug, Serialize)]
pub struct BulkImportResult {
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub format: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ImportUnitRow {
    pub building_code: String,
    pub floor_number: i64,
    pub unit_number: String,
    pub meter_number: Option<String>,
    pub status: Option<String>,
    pub resident_name: Option<String>,
    #[serde(alias = "contact_number")]
    pub contact: Option<String>,
    pub account_number: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportEnvelope {
    pub units: Option<Vec<ImportUnitRow>>,
    pub data: Option<Vec<ImportUnitRow>>,
}

fn normalize_required(value: &str) -> String {
    value.trim().to_string()
}

fn sanitize_file_name(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.trim_matches('_').is_empty() {
        "document".to_string()
    } else {
        sanitized
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

#[tauri::command]
pub async fn find_unit_on_floor(
    floor_id: i64,
    unit_number: String,
    state: State<'_, AppState>,
) -> Result<Option<UnitRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;
    let normalized = unit_number.trim().to_string();

    if normalized.is_empty() {
        return Ok(None);
    }

    let row = sqlx::query(
        "SELECT u.id, f.building_id, b.code as building_code, b.name as building_name,
                u.floor_id, f.floor_number, u.unit_number, u.meter_number, u.status,
                u.activated_at, u.deactivated_at, u.notes,
                a.id as account_id, a.account_number, a.resident_name,
                a.contact_number, a.outstanding_balance
         FROM units u
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.unit_id = u.id
         WHERE u.floor_id = ? AND u.unit_number = ?
         LIMIT 1"
    )
    .bind(floor_id)
    .bind(&normalized)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.map(|r| UnitRow {
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
    }))
}

fn parse_csv_units(content: &str) -> Result<Vec<ImportUnitRow>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(content.as_bytes());

    let mut rows = Vec::new();

    for record in reader.deserialize::<ImportUnitRow>() {
        rows.push(record.map_err(|error| error.to_string())?);
    }

    Ok(rows)
}

fn parse_json_units(content: &str) -> Result<Vec<ImportUnitRow>, String> {
    if let Ok(rows) = serde_json::from_str::<Vec<ImportUnitRow>>(content) {
        return Ok(rows);
    }

    let envelope: ImportEnvelope =
        serde_json::from_str(content).map_err(|error| error.to_string())?;

    envelope
        .units
        .or(envelope.data)
        .ok_or_else(|| "JSON import must contain a top-level `units` or `data` array.".to_string())
}

async fn import_unit_rows(
    rows: Vec<ImportUnitRow>,
    pool: &sqlx::SqlitePool,
) -> Result<BulkImportResult, String> {
    let mut result = BulkImportResult {
        total: rows.len(),
        imported: 0,
        skipped: 0,
        errors: vec![],
        format: String::new(),
    };

    for (index, raw) in rows.iter().enumerate() {
        let line = index + 2;
        let building_code = normalize_required(&raw.building_code);
        let unit_number = normalize_required(&raw.unit_number);
        let floor_number = raw.floor_number;
        let meter_number = normalize_optional(raw.meter_number.clone());
        let status = normalize_optional(raw.status.clone()).unwrap_or_else(|| "active".to_string());
        let resident_name = normalize_optional(raw.resident_name.clone());
        let contact = normalize_optional(raw.contact.clone());
        let account_number = normalize_optional(raw.account_number.clone());

        if building_code.is_empty() || unit_number.is_empty() {
            result.errors.push(format!(
                "Row {}: missing building_code or unit_number",
                line
            ));
            result.skipped += 1;
            continue;
        }

        let floor_id: Option<i64> = sqlx::query_scalar(
            "SELECT f.id FROM floors f
             JOIN buildings b ON b.id = f.building_id
             WHERE b.code = ? AND f.floor_number = ?"
        )
        .bind(&building_code)
        .bind(floor_number)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())?;

        let floor_id = match floor_id {
            Some(id) => id,
            None => {
                result.errors.push(format!(
                    "Row {}: building {} floor {} not found",
                    line, building_code, floor_number
                ));
                result.skipped += 1;
                continue;
            }
        };

        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM units WHERE floor_id = ? AND unit_number = ?"
        )
        .bind(floor_id)
        .bind(&unit_number)
        .fetch_one(pool)
        .await
        .map_err(|error| error.to_string())?;

        if exists > 0 {
            result.skipped += 1;
            result.errors.push(format!(
                "Row {}: unit {} already exists on {} floor {}",
                line, unit_number, building_code, floor_number
            ));
            continue;
        }

        let unit_id = sqlx::query(
            "INSERT INTO units (floor_id, unit_number, meter_number, status, activated_at)
             VALUES (?, ?, ?, ?, CASE WHEN ? = 'active' THEN datetime('now') ELSE NULL END)"
        )
        .bind(floor_id)
        .bind(&unit_number)
        .bind(&meter_number)
        .bind(&status)
        .bind(&status)
        .execute(pool)
        .await
        .map_err(|error| {
            result.errors.push(format!("Row {}: {}", line, error));
            error.to_string()
        })
        .map(|record| record.last_insert_rowid())
        .unwrap_or(0);

        if unit_id > 0 {
            if let Some(name) = resident_name {
                let account = account_number
                    .clone()
                    .unwrap_or_else(|| format!("ACC-{:07}", unit_id));
                sqlx::query(
                    "INSERT INTO accounts (unit_id, account_number, resident_name, contact_number)
                     VALUES (?, ?, ?, ?)"
                )
                .bind(unit_id)
                .bind(&account)
                .bind(name)
                .bind(&contact)
                .execute(pool)
                .await
                .ok();
            }

            result.imported += 1;
        }
    }

    Ok(result)
}

/// Supported formats:
/// CSV header: building_code,floor_number,unit_number,meter_number,status,resident_name,contact,account_number
/// JSON: either an array of unit rows or an object with a top-level `units` array.
#[tauri::command]
pub async fn bulk_import_units(
    csv_path: String,
    state: State<'_, AppState>,
) -> Result<BulkImportResult, String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    let content = std::fs::read_to_string(&csv_path).map_err(|error| error.to_string())?;
    let extension = Path::new(&csv_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("csv")
        .to_ascii_lowercase();

    let rows = match extension.as_str() {
        "json" => parse_json_units(&content)?,
        _ => parse_csv_units(&content)?,
    };

    let mut result = import_unit_rows(rows, &*pool).await?;
    result.format = extension.to_uppercase();

    audit_log(&pool, caller.id, "BULK_IMPORT", "units", None,
        &format!(
            "Imported {} of {} units from {}",
            result.imported, result.total, result.format
        ))
        .await.ok();

    Ok(result)
}
