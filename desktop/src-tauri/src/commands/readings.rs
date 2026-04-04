use crate::commands::auth::require_role;
use crate::db::connection::{audit_log, AppState};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteRow;
use sqlx::Row;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ReadingRow {
    pub id: i64,
    pub unit_id: i64,
    pub unit_number: String,
    pub building_code: String,
    pub building_name: String,
    pub floor_number: i64,
    pub resident_name: Option<String>,
    pub meter_number: Option<String>,
    pub billing_cycle_id: i64,
    pub previous_reading: f64,
    pub current_reading: Option<f64>,
    pub consumption: Option<f64>,
    pub status: String,
    pub flag_reason: Option<String>,
    pub notes: Option<String>,
    pub read_at: Option<String>,
    pub source: String,
    pub submitted_by: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
}

fn map_reading_row(row: &SqliteRow) -> ReadingRow {
    ReadingRow {
        id: row.get("id"),
        unit_id: row.get("unit_id"),
        unit_number: row.get("unit_number"),
        building_code: row.get("building_code"),
        building_name: row.get("building_name"),
        floor_number: row.get("floor_number"),
        resident_name: row.get("resident_name"),
        meter_number: row.get("meter_number"),
        billing_cycle_id: row.get("billing_cycle_id"),
        previous_reading: row.get("previous_reading"),
        current_reading: row.get("current_reading"),
        consumption: row.get("consumption"),
        status: row.get("status"),
        flag_reason: row.get("flag_reason"),
        notes: row.get("notes"),
        read_at: row.get("read_at"),
        source: row.get("source"),
        submitted_by: row.get("submitted_by"),
        approved_by: row.get("approved_by"),
        approved_at: row.get("approved_at"),
    }
}

async fn fetch_cycle_reading_row(
    pool: &sqlx::SqlitePool,
    billing_cycle_id: i64,
    unit_id: i64,
) -> Result<ReadingRow, String> {
    let row = sqlx::query(
        "SELECT mr.id, mr.unit_id, u.unit_number, b.code as building_code, b.name as building_name,
                f.floor_number, a.resident_name, u.meter_number,
                mr.billing_cycle_id, mr.previous_reading, mr.current_reading,
                mr.consumption, mr.status, mr.flag_reason, mr.notes,
                mr.read_at, mr.source,
                su.username as submitted_by,
                au.username as approved_by, mr.approved_at
         FROM meter_readings mr
         JOIN units u ON u.id = mr.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.unit_id = u.id
         LEFT JOIN users su ON su.id = mr.submitted_by
         LEFT JOIN users au ON au.id = mr.approved_by
         WHERE mr.billing_cycle_id = ? AND mr.unit_id = ?"
    )
    .bind(billing_cycle_id)
    .bind(unit_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(map_reading_row(&row))
}

#[tauri::command]
pub async fn list_readings_for_cycle(
    cycle_id: i64,
    status_filter: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ReadingRow>, String> {
    require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    let filter = status_filter.as_deref().unwrap_or("%");

    let rows = sqlx::query(
        "SELECT mr.id, mr.unit_id, u.unit_number, b.code as building_code, b.name as building_name,
                f.floor_number, a.resident_name, u.meter_number,
                mr.billing_cycle_id, mr.previous_reading, mr.current_reading,
                mr.consumption, mr.status, mr.flag_reason, mr.notes,
                mr.read_at, mr.source,
                su.username as submitted_by,
                au.username as approved_by, mr.approved_at
         FROM meter_readings mr
         JOIN units u ON u.id = mr.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.unit_id = u.id
         LEFT JOIN users su ON su.id = mr.submitted_by
         LEFT JOIN users au ON au.id = mr.approved_by
         WHERE mr.billing_cycle_id = ?
           AND (mr.status LIKE ? OR ? = '%')
         ORDER BY b.code, f.floor_number, u.unit_number"
    )
    .bind(cycle_id)
    .bind(filter)
    .bind(filter)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(map_reading_row).collect())
}

#[tauri::command]
pub async fn approve_reading(
    reading_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    sqlx::query(
        "UPDATE meter_readings
         SET status = 'approved', approved_by = ?, approved_at = datetime('now')
         WHERE id = ? AND status IN ('submitted', 'flagged')"
    )
    .bind(caller.id)
    .bind(reading_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    audit_log(
        &pool,
        caller.id,
        "APPROVE_READING",
        "meter_readings",
        Some(reading_id),
        "Reading approved",
    )
    .await
    .ok();
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct FlagReadingRequest {
    pub reading_id: i64,
    pub flag_reason: String,
}

#[tauri::command]
pub async fn flag_reading(
    payload: FlagReadingRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    sqlx::query(
        "UPDATE meter_readings SET status = 'flagged', flag_reason = ? WHERE id = ?"
    )
    .bind(&payload.flag_reason)
    .bind(payload.reading_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    audit_log(
        &pool,
        caller.id,
        "FLAG_READING",
        "meter_readings",
        Some(payload.reading_id),
        &payload.flag_reason,
    )
    .await
    .ok();
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ManualReadingRequest {
    pub unit_id: i64,
    pub billing_cycle_id: i64,
    pub previous_reading: f64,
    pub current_reading: f64,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn manual_entry_reading(
    payload: ManualReadingRequest,
    state: State<'_, AppState>,
) -> Result<ReadingRow, String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    let consumption = payload.current_reading - payload.previous_reading;
    let avg: Option<f64> = sqlx::query_scalar(
        "SELECT AVG(consumption) FROM meter_readings
         WHERE unit_id = ? AND status = 'approved'"
    )
    .bind(payload.unit_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .flatten();

    let (status, flag_reason) = if payload.current_reading < payload.previous_reading {
        ("flagged".to_string(), Some("CURRENT_BELOW_PREVIOUS".to_string()))
    } else if let Some(avg) = avg {
        if avg > 0.0 && consumption > avg * 3.0 {
            (
                "flagged".to_string(),
                Some(format!(
                    "ABNORMAL_SPIKE: {:.2} cu.m vs avg {:.2}",
                    consumption, avg
                )),
            )
        } else {
            ("submitted".to_string(), None)
        }
    } else {
        ("submitted".to_string(), None)
    };

    let id = sqlx::query(
        "INSERT INTO meter_readings
         (unit_id, billing_cycle_id, submitted_by, previous_reading, current_reading,
          status, flag_reason, notes, read_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'manual')
         ON CONFLICT(unit_id, billing_cycle_id) DO UPDATE SET
         submitted_by = excluded.submitted_by,
         previous_reading = excluded.previous_reading,
         current_reading = excluded.current_reading,
         status = excluded.status,
         flag_reason = excluded.flag_reason,
         notes = excluded.notes,
         read_at = excluded.read_at,
         source = excluded.source,
         approved_by = NULL,
         approved_at = NULL"
    )
    .bind(payload.unit_id)
    .bind(payload.billing_cycle_id)
    .bind(caller.id)
    .bind(payload.previous_reading)
    .bind(payload.current_reading)
    .bind(&status)
    .bind(&flag_reason)
    .bind(&payload.notes)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    let updated_row = fetch_cycle_reading_row(&*pool, payload.billing_cycle_id, payload.unit_id).await?;

    audit_log(
        &pool,
        caller.id,
        "MANUAL_READING",
        "meter_readings",
        Some(updated_row.id.max(id)),
        &format!(
            "Manual entry: {} -> {} cu.m",
            payload.previous_reading, payload.current_reading
        ),
    )
    .await
    .ok();

    Ok(updated_row)
}
