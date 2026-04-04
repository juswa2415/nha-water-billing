// src-tauri/src/commands/sync.rs

use crate::commands::auth::require_role;
use crate::db::connection::{AppState, audit_log};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

#[derive(Debug, Deserialize, Serialize)]
pub struct MobileReading {
    pub unit_id: i64,
    pub unit_number: String,
    pub building_code: String,
    pub previous_reading: f64,
    pub current_reading: f64,
    pub notes: Option<String>,
    pub photo_filename: Option<String>,
    pub read_at: String,
    pub submitted_by_username: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SyncPayload {
    pub version: String,
    pub exported_at: String,
    pub billing_cycle_id: i64,
    pub exported_by: String,
    pub readings: Vec<MobileReading>,
    pub checksum: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub total: usize,
    pub imported: usize,
    pub duplicates: usize,
    pub flagged: usize,
    pub errors: Vec<String>,
}

fn compute_checksum(readings: &[MobileReading]) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    for r in readings {
        hasher.update(format!("{}:{}", r.unit_id, r.current_reading).as_bytes());
    }
    hex::encode(hasher.finalize())
}

#[tauri::command]
pub async fn import_mobile_readings(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<ImportResult, String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    let raw = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Cannot read file: {}", e))?;

    let payload: SyncPayload = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid sync file format: {}", e))?;

    // Verify checksum
    let expected = compute_checksum(&payload.readings);
    if expected != payload.checksum {
        return Err("Checksum mismatch — file may be corrupted or tampered.".to_string());
    }

    // Verify cycle exists
    let cycle_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM billing_cycles WHERE id = ?"
    )
    .bind(payload.billing_cycle_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if cycle_exists == 0 {
        return Err(format!("Billing cycle {} not found.", payload.billing_cycle_id));
    }

    let mut result = ImportResult {
        total: payload.readings.len(),
        imported: 0,
        duplicates: 0,
        flagged: 0,
        errors: vec![],
    };

    for reading in &payload.readings {
        // Check for existing approved/submitted reading
        let existing = sqlx::query(
            "SELECT id, status, read_at FROM meter_readings
             WHERE unit_id = ? AND billing_cycle_id = ?"
        )
        .bind(reading.unit_id)
        .bind(payload.billing_cycle_id)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| e.to_string())?;

        match existing {
            Some(ex) => {
                let existing_status: String = ex.get("status");
                if ["approved", "submitted"].contains(&existing_status.as_str()) {
                    // Conflict: keep most recent
                    let existing_read_at: Option<String> = ex.get("read_at");
                    if let Some(ex_time) = existing_read_at {
                        if reading.read_at <= ex_time {
                            result.duplicates += 1;
                            continue;
                        }
                    } else {
                        result.duplicates += 1;
                        continue;
                    }
                }
            }
            None => {}
        }

        // Validate
        let consumption = reading.current_reading - reading.previous_reading;
        let avg_consumption: Option<f64> = sqlx::query_scalar(
            "SELECT AVG(consumption) FROM meter_readings
             WHERE unit_id = ? AND status = 'approved'"
        )
        .bind(reading.unit_id)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| e.to_string())?
        .flatten();

        let (status, flag_reason) = if reading.current_reading < reading.previous_reading {
            ("flagged".to_string(), Some("CURRENT_BELOW_PREVIOUS".to_string()))
        } else if let Some(avg) = avg_consumption {
            if avg > 0.0 && consumption > avg * 3.0 {
                ("flagged".to_string(), Some(format!(
                    "ABNORMAL_SPIKE: {:.2} cu.m (avg {:.2})", consumption, avg
                )))
            } else {
                ("submitted".to_string(), None)
            }
        } else {
            ("submitted".to_string(), None)
        };

        if flag_reason.is_some() { result.flagged += 1; }

        let res = sqlx::query(
            "INSERT INTO meter_readings
             (unit_id, billing_cycle_id, previous_reading, current_reading,
              status, flag_reason, notes, photo_path, read_at, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mobile')
             ON CONFLICT(unit_id, billing_cycle_id) DO UPDATE SET
             current_reading = excluded.current_reading,
             status = excluded.status,
             flag_reason = excluded.flag_reason,
             notes = excluded.notes,
             photo_path = excluded.photo_path,
             read_at = excluded.read_at"
        )
        .bind(reading.unit_id)
        .bind(payload.billing_cycle_id)
        .bind(reading.previous_reading)
        .bind(reading.current_reading)
        .bind(&status)
        .bind(&flag_reason)
        .bind(&reading.notes)
        .bind(&reading.photo_filename)
        .bind(&reading.read_at)
        .execute(&*pool)
        .await;

        match res {
            Ok(_) => result.imported += 1,
            Err(e) => result.errors.push(format!("Unit {}: {}", reading.unit_id, e)),
        }
    }

    audit_log(
        &pool, caller.id, "SYNC_IMPORT", "meter_readings", Some(payload.billing_cycle_id),
        &format!("Imported {}/{} readings from {}", result.imported, result.total, payload.exported_by),
    ).await.ok();

    Ok(result)
}

// Export reading list for mobile (pending readings only)
#[derive(Debug, Serialize)]
pub struct ExportUnitEntry {
    pub unit_id: i64,
    pub unit_number: String,
    pub building_code: String,
    pub floor_number: i64,
    pub meter_number: Option<String>,
    pub resident_name: Option<String>,
    pub previous_reading: f64,
    pub reading_status: String,
}

#[derive(Debug, Serialize)]
pub struct ExportPayload {
    pub billing_cycle_id: i64,
    pub period_start: String,
    pub period_end: String,
    pub exported_at: String,
    pub units: Vec<ExportUnitEntry>,
}

#[tauri::command]
pub async fn export_reading_list(
    cycle_id: i64,
    output_path: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    let cycle = sqlx::query(
        "SELECT period_start, period_end FROM billing_cycles WHERE id = ?"
    )
    .bind(cycle_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let rows = sqlx::query(
        "SELECT mr.unit_id, u.unit_number, b.code as building_code,
                f.floor_number, u.meter_number, a.resident_name,
                mr.previous_reading, mr.status as reading_status
         FROM meter_readings mr
         JOIN units u ON u.id = mr.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.unit_id = u.id
         WHERE mr.billing_cycle_id = ?
         ORDER BY b.code, f.floor_number, u.unit_number"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let units: Vec<ExportUnitEntry> = rows.iter().map(|r| ExportUnitEntry {
        unit_id: r.get("unit_id"),
        unit_number: r.get("unit_number"),
        building_code: r.get("building_code"),
        floor_number: r.get("floor_number"),
        meter_number: r.get("meter_number"),
        resident_name: r.get("resident_name"),
        previous_reading: r.get("previous_reading"),
        reading_status: r.get("reading_status"),
    }).collect();

    let count = units.len();

    let payload = ExportPayload {
        billing_cycle_id: cycle_id,
        period_start: cycle.get("period_start"),
        period_end: cycle.get("period_end"),
        exported_at: chrono::Utc::now().to_rfc3339(),
        units,
    };

    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| e.to_string())?;

    std::fs::write(&output_path, json)
        .map_err(|e| format!("Cannot write file: {}", e))?;

    audit_log(&pool, caller.id, "EXPORT_READING_LIST", "meter_readings",
        Some(cycle_id), &format!("Exported {} units to {}", count, output_path))
        .await.ok();

    Ok(count)
}
