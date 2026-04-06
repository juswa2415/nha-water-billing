use crate::commands::auth::require_role;
use crate::commands::billing::build_disconnection_policy;
use crate::db::connection::{audit_log, AppState};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Serialize)]
pub struct ServiceCaseRow {
    pub unit_id: i64,
    pub account_id: Option<i64>,
    pub building_code: String,
    pub building_name: String,
    pub floor_number: i64,
    pub unit_number: String,
    pub unit_status: String,
    pub resident_name: Option<String>,
    pub account_number: Option<String>,
    pub outstanding_balance: f64,
    pub unpaid_periods: i64,
    pub disconnection_effective_date: Option<String>,
    pub is_subject_for_disconnection: bool,
    pub can_disconnect: bool,
    pub can_reconnect: bool,
    pub service_stage: String,
    pub last_action_id: Option<i64>,
    pub last_action_type: Option<String>,
    pub last_action_date: Option<String>,
    pub last_action_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ServiceActionHistoryRow {
    pub id: i64,
    pub unit_id: i64,
    pub account_id: Option<i64>,
    pub action_type: String,
    pub action_date: String,
    pub effective_date: Option<String>,
    pub outstanding_balance: f64,
    pub unpaid_periods: i64,
    pub reason: String,
    pub notes: Option<String>,
    pub building_code: String,
    pub unit_number: String,
    pub resident_name: Option<String>,
    pub account_number: Option<String>,
    pub recorded_by_name: Option<String>,
    pub documents_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceActionDocumentInput {
    pub source_path: String,
    pub document_type: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordDisconnectionRequest {
    pub unit_id: i64,
    pub action_date: String,
    pub reason: String,
    pub notes: Option<String>,
    pub documents: Vec<ServiceActionDocumentInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordReconnectionRequest {
    pub unit_id: i64,
    pub action_date: String,
    pub reason: String,
    pub notes: Option<String>,
    pub documents: Vec<ServiceActionDocumentInput>,
}

#[derive(Debug, Serialize)]
pub struct ServiceActionResult {
    pub action_id: i64,
    pub unit_id: i64,
    pub action_type: String,
    pub unit_status: String,
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

fn parse_action_date(value: &str) -> Result<String, String> {
    let parsed = NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| "Action date must be in YYYY-MM-DD format.".to_string())?;
    Ok(parsed.format("%Y-%m-%d").to_string())
}

fn normalize_notes(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

async fn store_action_documents(
    action_id: i64,
    documents: &[ServiceActionDocumentInput],
    app: &AppHandle,
    pool: &sqlx::SqlitePool,
    user_id: i64,
) -> Result<(), String> {
    if documents.is_empty() {
        return Err("Attach at least one supporting document.".to_string());
    }

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let docs_dir = app_dir
        .join("service-actions")
        .join(format!("action-{}", action_id));
    fs::create_dir_all(&docs_dir).map_err(|e| e.to_string())?;

    for document in documents {
        let source_path = document.source_path.trim();
        if source_path.is_empty() {
            return Err("A selected document path is empty.".to_string());
        }

        let source = Path::new(source_path);
        if !source.exists() {
            return Err(format!("Document not found: {}", source_path));
        }

        let document_type = document.document_type.trim();
        if document_type.is_empty() {
            return Err("Document type is required for every attachment.".to_string());
        }

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

        let document_notes = normalize_notes(document.notes.clone());

        sqlx::query(
            "INSERT INTO service_action_documents
                (service_action_id, document_type, original_name, stored_path, notes, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(action_id)
        .bind(document_type)
        .bind(&original_name)
        .bind(stored_path.to_string_lossy().to_string())
        .bind(document_notes.as_deref())
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn list_service_cases(
    state: State<'_, AppState>,
) -> Result<Vec<ServiceCaseRow>, String> {
    require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT u.id as unit_id,
                a.id as account_id,
                b.code as building_code,
                b.name as building_name,
                f.floor_number,
                u.unit_number,
                u.status as unit_status,
                a.resident_name,
                a.account_number,
                COALESCE(a.outstanding_balance, 0.0) as outstanding_balance,
                (
                    SELECT sa.id
                    FROM service_actions sa
                    WHERE sa.unit_id = u.id
                    ORDER BY sa.action_date DESC, sa.id DESC
                    LIMIT 1
                ) as last_action_id,
                (
                    SELECT sa.action_type
                    FROM service_actions sa
                    WHERE sa.unit_id = u.id
                    ORDER BY sa.action_date DESC, sa.id DESC
                    LIMIT 1
                ) as last_action_type,
                (
                    SELECT sa.action_date
                    FROM service_actions sa
                    WHERE sa.unit_id = u.id
                    ORDER BY sa.action_date DESC, sa.id DESC
                    LIMIT 1
                ) as last_action_date,
                (
                    SELECT sa.reason
                    FROM service_actions sa
                    WHERE sa.unit_id = u.id
                    ORDER BY sa.action_date DESC, sa.id DESC
                    LIMIT 1
                ) as last_action_reason
         FROM units u
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.unit_id = u.id
         WHERE u.status = 'disconnected' OR a.id IS NOT NULL
         ORDER BY
            CASE WHEN u.status = 'disconnected' THEN 0 ELSE 1 END,
            b.code,
            f.floor_number,
            u.unit_number",
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();

    for row in rows {
        let unit_status: String = row.get("unit_status");
        let account_id: Option<i64> = row.get("account_id");
        let outstanding_balance: f64 = row.get("outstanding_balance");

        let (unpaid_periods, disconnection_effective_date, is_subject_for_disconnection) =
            if let Some(account_id) = account_id {
                let policy = build_disconnection_policy(&pool, account_id).await?;
                (
                    policy.unpaid_periods,
                    policy.effective_date,
                    policy.is_eligible,
                )
            } else {
                (0, None, false)
            };

        if unit_status != "disconnected" && (unpaid_periods == 0 || outstanding_balance <= 0.0) {
            continue;
        }

        let can_disconnect = unit_status != "disconnected" && is_subject_for_disconnection;
        let can_reconnect = unit_status == "disconnected" && outstanding_balance <= 0.0;
        let service_stage = if unit_status == "disconnected" {
            if can_reconnect {
                "ready_reconnect"
            } else {
                "disconnected"
            }
        } else if is_subject_for_disconnection {
            "eligible"
        } else {
            "watch"
        };

        result.push(ServiceCaseRow {
            unit_id: row.get("unit_id"),
            account_id,
            building_code: row.get("building_code"),
            building_name: row.get("building_name"),
            floor_number: row.get("floor_number"),
            unit_number: row.get("unit_number"),
            unit_status,
            resident_name: row.get("resident_name"),
            account_number: row.get("account_number"),
            outstanding_balance,
            unpaid_periods,
            disconnection_effective_date,
            is_subject_for_disconnection,
            can_disconnect,
            can_reconnect,
            service_stage: service_stage.to_string(),
            last_action_id: row.get("last_action_id"),
            last_action_type: row.get("last_action_type"),
            last_action_date: row.get("last_action_date"),
            last_action_reason: row.get("last_action_reason"),
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn list_service_action_history(
    state: State<'_, AppState>,
) -> Result<Vec<ServiceActionHistoryRow>, String> {
    require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT sa.id,
                sa.unit_id,
                sa.account_id,
                sa.action_type,
                sa.action_date,
                sa.effective_date,
                sa.outstanding_balance,
                sa.unpaid_periods,
                sa.reason,
                sa.notes,
                b.code as building_code,
                u.unit_number,
                a.resident_name,
                a.account_number,
                usr.full_name as recorded_by_name,
                (
                    SELECT COUNT(*)
                    FROM service_action_documents sad
                    WHERE sad.service_action_id = sa.id
                ) as documents_count
         FROM service_actions sa
         JOIN units u ON u.id = sa.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.id = sa.account_id
         LEFT JOIN users usr ON usr.id = sa.recorded_by
         ORDER BY sa.action_date DESC, sa.id DESC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| ServiceActionHistoryRow {
            id: row.get("id"),
            unit_id: row.get("unit_id"),
            account_id: row.get("account_id"),
            action_type: row.get("action_type"),
            action_date: row.get("action_date"),
            effective_date: row.get("effective_date"),
            outstanding_balance: row.get("outstanding_balance"),
            unpaid_periods: row.get("unpaid_periods"),
            reason: row.get("reason"),
            notes: row.get("notes"),
            building_code: row.get("building_code"),
            unit_number: row.get("unit_number"),
            resident_name: row.get("resident_name"),
            account_number: row.get("account_number"),
            recorded_by_name: row.get("recorded_by_name"),
            documents_count: row.get("documents_count"),
        })
        .collect())
}

#[tauri::command]
pub async fn record_service_disconnection(
    payload: RecordDisconnectionRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ServiceActionResult, String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    if payload.documents.is_empty() {
        return Err("Attach at least one supporting document before saving the disconnection record.".to_string());
    }

    let action_date = parse_action_date(&payload.action_date)?;
    let reason = payload.reason.trim().to_string();
    if reason.is_empty() {
        return Err("Reason for disconnection is required.".to_string());
    }

    let row = sqlx::query(
        "SELECT u.id as unit_id,
                u.status as unit_status,
                a.id as account_id,
                COALESCE(a.outstanding_balance, 0.0) as outstanding_balance,
                b.code as building_code,
                u.unit_number
         FROM units u
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.unit_id = u.id
         WHERE u.id = ?",
    )
    .bind(payload.unit_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Unit not found.".to_string())?;

    let unit_status: String = row.get("unit_status");
    if unit_status == "disconnected" {
        return Err("This unit is already marked as disconnected.".to_string());
    }

    let account_id: Option<i64> = row.get("account_id");
    let account_id = account_id.ok_or_else(|| "This unit has no resident account to evaluate for disconnection.".to_string())?;
    let policy = build_disconnection_policy(&pool, account_id).await?;

    if !policy.is_eligible {
        return Err(format!(
            "This unit is not yet eligible for disconnection. It currently has {} unpaid billing period(s).",
            policy.unpaid_periods
        ));
    }

    if let Some(effective_date) = &policy.effective_date {
        if action_date < *effective_date {
            return Err(format!(
                "Disconnection cannot be recorded before the eligibility date {}.",
                effective_date
            ));
        }
    }

    let action_notes = normalize_notes(payload.notes);

    let action_id = sqlx::query(
        "INSERT INTO service_actions
            (unit_id, account_id, action_type, action_date, effective_date, outstanding_balance, unpaid_periods, reason, notes, recorded_by)
         VALUES (?, ?, 'disconnection', ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(payload.unit_id)
    .bind(account_id)
    .bind(&action_date)
    .bind(policy.effective_date.as_deref())
    .bind(row.get::<f64, _>("outstanding_balance"))
    .bind(policy.unpaid_periods)
    .bind(&reason)
    .bind(action_notes.as_deref())
    .bind(caller.id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    if let Err(error) = store_action_documents(action_id, &payload.documents, &app, &*pool, caller.id).await {
        sqlx::query("DELETE FROM service_actions WHERE id = ?")
            .bind(action_id)
            .execute(&*pool)
            .await
            .ok();
        return Err(error);
    }

    sqlx::query(
        "UPDATE units
         SET status = 'disconnected',
             deactivated_at = ?
         WHERE id = ?",
    )
    .bind(&action_date)
    .bind(payload.unit_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    audit_log(
        &pool,
        caller.id,
        "RECORD_DISCONNECTION",
        "service_actions",
        Some(action_id),
        &format!(
            "Disconnected unit {}-{} after {} unpaid billing period(s).",
            row.get::<String, _>("building_code"),
            row.get::<String, _>("unit_number"),
            policy.unpaid_periods
        ),
    )
    .await
    .ok();

    Ok(ServiceActionResult {
        action_id,
        unit_id: payload.unit_id,
        action_type: "disconnection".to_string(),
        unit_status: "disconnected".to_string(),
    })
}

#[tauri::command]
pub async fn record_service_reconnection(
    payload: RecordReconnectionRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ServiceActionResult, String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    if payload.documents.is_empty() {
        return Err("Attach at least one supporting document before saving the reconnection record.".to_string());
    }

    let action_date = parse_action_date(&payload.action_date)?;
    let reason = payload.reason.trim().to_string();
    if reason.is_empty() {
        return Err("Reason for reconnection is required.".to_string());
    }

    let row = sqlx::query(
        "SELECT u.id as unit_id,
                u.status as unit_status,
                a.id as account_id,
                COALESCE(a.outstanding_balance, 0.0) as outstanding_balance,
                b.code as building_code,
                u.unit_number
         FROM units u
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings b ON b.id = f.building_id
         LEFT JOIN accounts a ON a.unit_id = u.id
         WHERE u.id = ?",
    )
    .bind(payload.unit_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Unit not found.".to_string())?;

    let unit_status: String = row.get("unit_status");
    if unit_status != "disconnected" {
        return Err("Only disconnected units can be reconnected from this page.".to_string());
    }

    let outstanding_balance: f64 = row.get("outstanding_balance");
    if outstanding_balance > 0.0 {
        return Err(format!(
            "This account still has an open balance of {:.2}. Clear the obligations first before reconnection.",
            outstanding_balance
        ));
    }

    let action_notes = normalize_notes(payload.notes);

    let action_id = sqlx::query(
        "INSERT INTO service_actions
            (unit_id, account_id, action_type, action_date, effective_date, outstanding_balance, unpaid_periods, reason, notes, recorded_by)
         VALUES (?, ?, 'reconnection', ?, NULL, ?, 0, ?, ?, ?)",
    )
    .bind(payload.unit_id)
    .bind(row.get::<Option<i64>, _>("account_id"))
    .bind(&action_date)
    .bind(outstanding_balance)
    .bind(&reason)
    .bind(action_notes.as_deref())
    .bind(caller.id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    if let Err(error) = store_action_documents(action_id, &payload.documents, &app, &*pool, caller.id).await {
        sqlx::query("DELETE FROM service_actions WHERE id = ?")
            .bind(action_id)
            .execute(&*pool)
            .await
            .ok();
        return Err(error);
    }

    sqlx::query(
        "UPDATE units
         SET status = 'active',
             activated_at = ?,
             deactivated_at = NULL
         WHERE id = ?",
    )
    .bind(&action_date)
    .bind(payload.unit_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    audit_log(
        &pool,
        caller.id,
        "RECORD_RECONNECTION",
        "service_actions",
        Some(action_id),
        &format!(
            "Reconnected unit {}-{} after balance clearance.",
            row.get::<String, _>("building_code"),
            row.get::<String, _>("unit_number"),
        ),
    )
    .await
    .ok();

    Ok(ServiceActionResult {
        action_id,
        unit_id: payload.unit_id,
        action_type: "reconnection".to_string(),
        unit_status: "active".to_string(),
    })
}
