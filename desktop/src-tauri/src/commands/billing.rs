// src-tauri/src/commands/billing.rs

use crate::commands::auth::require_role;
use crate::db::connection::{AppState, audit_log, get_setting};
use chrono::{Datelike, Duration, Local, Months, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

// ── Billing Cycles ────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct BillingCycleRow {
    pub id: i64,
    pub period_start: String,
    pub period_end: String,
    pub status: String,
    pub rate_per_cubicm: f64,
    pub maynilad_prev: Option<f64>,
    pub maynilad_curr: Option<f64>,
    pub total_active_units_camres: Option<i64>,
    pub created_at: String,
    pub finalized_at: Option<String>,
    // Stats
    pub total_units: i64,
    pub readings_submitted: i64,
    pub readings_approved: i64,
    pub bills_generated: i64,
}

#[tauri::command]
pub async fn list_billing_cycles(
    state: State<'_, AppState>,
) -> Result<Vec<BillingCycleRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT bc.*,
                COUNT(DISTINCT mr.id) FILTER (WHERE mr.status != 'pending') as readings_submitted,
                COUNT(DISTINCT mr.id) FILTER (WHERE mr.status = 'approved') as readings_approved,
                COUNT(DISTINCT b.id) as bills_generated,
                (SELECT COUNT(*) FROM units WHERE status = 'active') as total_units
         FROM billing_cycles bc
         LEFT JOIN meter_readings mr ON mr.billing_cycle_id = bc.id
         LEFT JOIN bills b ON b.billing_cycle_id = bc.id
         GROUP BY bc.id
         ORDER BY bc.period_start DESC"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| BillingCycleRow {
        id: r.get("id"),
        period_start: r.get("period_start"),
        period_end: r.get("period_end"),
        status: r.get("status"),
        rate_per_cubicm: r.get("rate_per_cubicm"),
        maynilad_prev: r.get("maynilad_prev"),
        maynilad_curr: r.get("maynilad_curr"),
        total_active_units_camres: r.get("total_active_units_camres"),
        created_at: r.get("created_at"),
        finalized_at: r.get("finalized_at"),
        total_units: r.get("total_units"),
        readings_submitted: r.get("readings_submitted"),
        readings_approved: r.get("readings_approved"),
        bills_generated: r.get("bills_generated"),
    }).collect())
}

#[derive(Debug, Deserialize)]
pub struct CreateCycleRequest {
    pub period_start: String,
    pub period_end: String,
    pub rate_per_cubicm: f64,
    pub maynilad_prev: Option<f64>,
    pub maynilad_curr: Option<f64>,
    pub total_active_units_camres: Option<i64>,
}

fn parse_cycle_date(value: &str, field_name: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| format!("{} must use YYYY-MM-DD format.", field_name))
}

fn expected_cycle_end(period_start: NaiveDate) -> Result<NaiveDate, String> {
    period_start
        .checked_add_months(Months::new(1))
        .and_then(|next_month| next_month.checked_sub_signed(Duration::days(1)))
        .ok_or_else(|| "Could not compute the billing period end.".to_string())
}

fn compute_bill_due_date(period_end: NaiveDate) -> Result<NaiveDate, String> {
    period_end
        .with_day(1)
        .ok_or_else(|| "Could not normalize the billing month.".to_string())?
        .checked_add_months(Months::new(1))
        .and_then(|next_month| next_month.checked_sub_signed(Duration::days(1)))
        .ok_or_else(|| "Could not compute the bill due date.".to_string())
}

fn normalize_due_date(
    period_end: &str,
    stored_due_date: Option<String>,
) -> Result<String, String> {
    let period_end_date = parse_cycle_date(period_end, "Bill period end")?;
    let computed_due_date = compute_bill_due_date(period_end_date)?
        .format("%Y-%m-%d")
        .to_string();

    match stored_due_date {
        Some(value) if value != period_end => Ok(value),
        _ => Ok(computed_due_date),
    }
}

async fn recompute_account_outstanding_balance(
    pool: &sqlx::SqlitePool,
    account_id: i64,
) -> Result<f64, String> {
    let total_new_charges: f64 = sqlx::query_scalar(
        "SELECT COALESCE(CAST(SUM(total_amount_due - previous_balance) AS REAL), 0.0)
         FROM bills
         WHERE account_id = ?",
    )
    .bind(account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let total_payments: f64 = sqlx::query_scalar(
        "SELECT COALESCE(CAST(SUM(p.amount_paid) AS REAL), 0.0)
         FROM payments p
         JOIN bills b ON b.id = p.bill_id
         WHERE b.account_id = ? AND p.is_void = 0",
    )
    .bind(account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let new_balance = round2(total_new_charges - total_payments);

    sqlx::query("UPDATE accounts SET outstanding_balance = ? WHERE id = ?")
        .bind(new_balance)
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(new_balance)
}

#[derive(Debug)]
pub(crate) struct DisconnectionPolicyInfo {
    pub(crate) unpaid_periods: i64,
    pub(crate) trigger_unpaid_bills: i64,
    pub(crate) effective_date: Option<String>,
    pub(crate) notice: String,
    pub(crate) is_eligible: bool,
}

pub(crate) async fn build_disconnection_policy(
    pool: &sqlx::SqlitePool,
    account_id: i64,
) -> Result<DisconnectionPolicyInfo, String> {
    let grace_days: i64 = get_setting(pool, "disconnection_notice_days")
        .await
        .unwrap_or_else(|_| "7".to_string())
        .parse()
        .unwrap_or(7)
        .max(0);
    let trigger_unpaid_bills: i64 = get_setting(pool, "disconnection_trigger_unpaid_bills")
        .await
        .unwrap_or_else(|_| "2".to_string())
        .parse()
        .unwrap_or(2)
        .max(1);

    let bill_rows = sqlx::query(
        "SELECT b.id,
                b.total_for_month,
                b.due_date,
                bc.period_end
         FROM bills b
         JOIN billing_cycles bc ON bc.id = b.billing_cycle_id
         WHERE b.account_id = ?
         ORDER BY bc.period_start ASC, b.id ASC",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let total_paid_before: f64 = sqlx::query_scalar(
        "SELECT COALESCE(CAST(SUM(p.amount_paid) AS REAL), 0.0)
         FROM payments p
         JOIN bills b ON b.id = p.bill_id
         WHERE b.account_id = ? AND p.is_void = 0",
    )
    .bind(account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut remaining_credit_before = round2(total_paid_before.max(0.0));
    let mut open_due_dates: Vec<String> = Vec::new();

    for row in bill_rows {
        let total_for_month: f64 = row.get("total_for_month");
        let effective_open_balance = if remaining_credit_before >= total_for_month {
            remaining_credit_before = round2(remaining_credit_before - total_for_month);
            0.0
        } else {
            let open = round2(total_for_month - remaining_credit_before);
            remaining_credit_before = 0.0;
            open
        };

        if effective_open_balance <= 0.0 {
            continue;
        }

        open_due_dates.push(normalize_due_date(
            &row.get::<String, _>("period_end"),
            row.get("due_date"),
        )?);
    }

    let unpaid_periods = open_due_dates.len() as i64;
    if unpaid_periods == 0 {
        return Ok(DisconnectionPolicyInfo {
            unpaid_periods,
            trigger_unpaid_bills,
            effective_date: None,
            notice: "Account is fully settled. No disconnection notice applies.".to_string(),
            is_eligible: false,
        });
    }

    if unpaid_periods < trigger_unpaid_bills {
        return Ok(DisconnectionPolicyInfo {
            unpaid_periods,
            trigger_unpaid_bills,
            effective_date: None,
            notice: format!(
                "Actual disconnection applies only after {} unpaid billing period(s). This account currently has {} unpaid billing period(s).",
                trigger_unpaid_bills, unpaid_periods
            ),
            is_eligible: false,
        });
    }

    let trigger_index = (trigger_unpaid_bills - 1) as usize;
    let trigger_due_date = parse_cycle_date(
        open_due_dates
            .get(trigger_index)
            .ok_or_else(|| "Could not determine the disconnection trigger bill.".to_string())?,
        "Disconnection trigger due date",
    )?;
    let effective_date = trigger_due_date
        .checked_add_signed(Duration::days(grace_days))
        .ok_or_else(|| "Could not compute the disconnection date.".to_string())?;
    let effective_date_string = effective_date.format("%Y-%m-%d").to_string();
    let today = Local::now().date_naive();
    let is_eligible = today >= effective_date;

    let notice = if is_eligible {
        format!(
            "Subject for disconnection starting {} because {} unpaid billing period(s) are already beyond the grace period.",
            effective_date_string, trigger_unpaid_bills
        )
    } else {
        format!(
            "If still unpaid, this account becomes eligible for disconnection on {} because it has reached {} unpaid billing period(s).",
            effective_date_string, trigger_unpaid_bills
        )
    };

    Ok(DisconnectionPolicyInfo {
        unpaid_periods,
        trigger_unpaid_bills,
        effective_date: Some(effective_date_string),
        notice,
        is_eligible,
    })
}

pub(crate) async fn build_uniform_bill_notice(
    pool: &sqlx::SqlitePool,
) -> Result<String, String> {
    let grace_days: i64 = get_setting(pool, "disconnection_notice_days")
        .await
        .unwrap_or_else(|_| "7".to_string())
        .parse()
        .unwrap_or(7)
        .max(0);
    let trigger_unpaid_bills: i64 = get_setting(pool, "disconnection_trigger_unpaid_bills")
        .await
        .unwrap_or_else(|_| "2".to_string())
        .parse()
        .unwrap_or(2)
        .max(1);

    Ok(format!(
        "If the account remains unpaid for {} billing period(s) and is still unsettled {} day(s) after the due date of the triggering bill, the water service may be subject to disconnection in accordance with NHA policy.",
        trigger_unpaid_bills, grace_days
    ))
}

#[tauri::command]
pub async fn create_billing_cycle(
    payload: CreateCycleRequest,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;
    let _requested_active_units_snapshot = payload.total_active_units_camres;

    if payload.rate_per_cubicm <= 0.0 {
        return Err("Rate per cubic meter must be greater than zero.".to_string());
    }

    let period_start = parse_cycle_date(&payload.period_start, "Period start")?;
    let period_end = parse_cycle_date(&payload.period_end, "Period end")?;
    let required_period_end = expected_cycle_end(period_start)?;

    if period_end != required_period_end {
        return Err(format!(
            "Billing cycles must cover exactly one monthly period. Expected period end: {}",
            required_period_end.format("%Y-%m-%d")
        ));
    }

    let overlapping_cycles: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM billing_cycles
         WHERE period_start <= ? AND period_end >= ?"
    )
    .bind(&payload.period_end)
    .bind(&payload.period_start)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if overlapping_cycles > 0 {
        return Err("That billing period overlaps an existing cycle.".to_string());
    }

    let latest_cycle = sqlx::query(
        "SELECT id, period_end, status, maynilad_curr
         FROM billing_cycles
         ORDER BY period_start DESC
         LIMIT 1"
    )
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let resolved_maynilad_prev = if let Some(latest) = &latest_cycle {
        let latest_status: String = latest.get("status");
        if latest_status != "locked" {
            return Err(
                "Close the current billing cycle before creating the next one.".to_string(),
            );
        }

        let latest_period_end = parse_cycle_date(
            &latest.get::<String, _>("period_end"),
            "Latest cycle end date",
        )?;
        let required_start = latest_period_end
            .checked_add_signed(Duration::days(1))
            .ok_or_else(|| "Could not compute the next allowed billing start date.".to_string())?;

        if period_start != required_start {
            return Err(format!(
                "The next billing cycle must start on {}.",
                required_start.format("%Y-%m-%d")
            ));
        }

        latest.get::<Option<f64>, _>("maynilad_curr").or(payload.maynilad_prev)
    } else {
        payload.maynilad_prev
    };

    if let (Some(prev), Some(curr)) = (resolved_maynilad_prev, payload.maynilad_curr) {
        if curr < prev {
            return Err("Maynilad current reading cannot be lower than the previous reading.".to_string());
        }
    }

    let active_units_snapshot: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM units WHERE status = 'active'"
    )
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if active_units_snapshot <= 0 {
        return Err("No active units were found. Create at least one active unit before opening a billing cycle.".to_string());
    }

    let id = sqlx::query(
        "INSERT INTO billing_cycles
         (period_start, period_end, rate_per_cubicm, maynilad_prev, maynilad_curr,
          total_active_units_camres, created_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')"
    )
    .bind(&payload.period_start)
    .bind(&payload.period_end)
    .bind(payload.rate_per_cubicm)
    .bind(resolved_maynilad_prev)
    .bind(payload.maynilad_curr)
    .bind(active_units_snapshot)
    .bind(caller.id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    // Pre-populate pending readings for all active units
    sqlx::query(
        "INSERT OR IGNORE INTO meter_readings
         (unit_id, billing_cycle_id, previous_reading, status, source)
         SELECT u.id, ?,
           COALESCE(
             (SELECT current_reading FROM meter_readings mr2
              JOIN billing_cycles bc2 ON bc2.id = mr2.billing_cycle_id
              WHERE mr2.unit_id = u.id AND mr2.status = 'approved'
              ORDER BY bc2.period_end DESC LIMIT 1),
             0
           ),
           'pending', 'mobile'
         FROM units u
         WHERE u.status = 'active'"
    )
    .bind(id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    audit_log(&pool, caller.id, "CREATE_CYCLE", "billing_cycles", Some(id),
        &format!("Cycle {} to {}", payload.period_start, payload.period_end))
        .await.ok();

    Ok(id)
}

#[derive(Debug, Deserialize)]
pub struct UpdateCycleStatusRequest {
    pub cycle_id: i64,
    pub status: String,
    pub maynilad_prev: Option<f64>,
    pub maynilad_curr: Option<f64>,
    pub total_active_units_camres: Option<i64>,
}

#[tauri::command]
pub async fn update_billing_cycle_status(
    payload: UpdateCycleStatusRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    sqlx::query(
        "UPDATE billing_cycles SET status = ?,
         maynilad_prev = COALESCE(?, maynilad_prev),
         maynilad_curr = COALESCE(?, maynilad_curr),
         total_active_units_camres = COALESCE(?, total_active_units_camres),
         finalized_at = CASE WHEN ? IN ('finalized','locked') THEN datetime('now') ELSE finalized_at END
         WHERE id = ? AND status != 'locked'"
    )
    .bind(&payload.status)
    .bind(payload.maynilad_prev)
    .bind(payload.maynilad_curr)
    .bind(payload.total_active_units_camres)
    .bind(&payload.status)
    .bind(payload.cycle_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    audit_log(&pool, caller.id, "UPDATE_CYCLE_STATUS", "billing_cycles",
        Some(payload.cycle_id), &format!("Status → {}", payload.status))
        .await.ok();
    Ok(())
}

// ── Building Sub-meter Readings ───────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BldgSubReadingRequest {
    pub building_id: i64,
    pub billing_cycle_id: i64,
    pub previous_reading: f64,
    pub current_reading: f64,
}

#[tauri::command]
pub async fn set_bldg_sub_reading(
    payload: BldgSubReadingRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    sqlx::query(
        "INSERT INTO bldg_sub_readings (building_id, billing_cycle_id, previous_reading, current_reading)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(building_id, billing_cycle_id)
         DO UPDATE SET previous_reading = excluded.previous_reading,
                       current_reading = excluded.current_reading"
    )
    .bind(payload.building_id)
    .bind(payload.billing_cycle_id)
    .bind(payload.previous_reading)
    .bind(payload.current_reading)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    audit_log(&pool, caller.id, "SET_BLDG_SUB_READING", "bldg_sub_readings",
        Some(payload.building_id), "Building sub-meter updated")
        .await.ok();
    Ok(())
}

#[tauri::command]
pub async fn delete_billing_cycle(
    cycle_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    let latest_cycle_id: Option<i64> = sqlx::query_scalar(
        "SELECT id
         FROM billing_cycles
         ORDER BY period_start DESC
         LIMIT 1",
    )
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if latest_cycle_id != Some(cycle_id) {
        return Err(
            "Only the latest billing cycle can be deleted. This keeps later balances and readings consistent.".to_string(),
        );
    }

    let cycle_row = sqlx::query(
        "SELECT period_start, period_end, status
         FROM billing_cycles
         WHERE id = ?",
    )
    .bind(cycle_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Billing cycle not found.".to_string())?;

    let affected_account_rows = sqlx::query(
        "SELECT DISTINCT account_id
         FROM bills
         WHERE billing_cycle_id = ?",
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let affected_account_ids: Vec<i64> = affected_account_rows
        .iter()
        .map(|row| row.get("account_id"))
        .collect();

    sqlx::query(
        "DELETE FROM payments
         WHERE bill_id IN (
            SELECT id FROM bills WHERE billing_cycle_id = ?
         )",
    )
    .bind(cycle_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM bills WHERE billing_cycle_id = ?")
        .bind(cycle_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM meter_readings WHERE billing_cycle_id = ?")
        .bind(cycle_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM bldg_sub_readings WHERE billing_cycle_id = ?")
        .bind(cycle_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM billing_cycles WHERE id = ?")
        .bind(cycle_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    for account_id in affected_account_ids {
        recompute_account_outstanding_balance(&pool, account_id).await?;
    }

    audit_log(
        &pool,
        caller.id,
        "DELETE_CYCLE",
        "billing_cycles",
        Some(cycle_id),
        &format!(
            "Deleted latest cycle {} to {} ({})",
            cycle_row.get::<String, _>("period_start"),
            cycle_row.get::<String, _>("period_end"),
            cycle_row.get::<String, _>("status")
        ),
    )
    .await
    .ok();

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct BldgSubReadingRow {
    pub building_id: i64,
    pub building_code: String,
    pub building_name: String,
    pub sub_meter_number: Option<String>,
    pub previous_reading: Option<f64>,
    pub current_reading: Option<f64>,
    pub total_consumption: Option<f64>,
}

#[tauri::command]
pub async fn list_bldg_sub_readings_for_cycle(
    cycle_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<BldgSubReadingRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT b.id AS building_id, b.code AS building_code, b.name AS building_name,
                b.sub_meter_number,
                s.previous_reading, s.current_reading, s.total_consumption
         FROM buildings b
         LEFT JOIN bldg_sub_readings s
           ON s.building_id = b.id AND s.billing_cycle_id = ?
         ORDER BY b.code"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| BldgSubReadingRow {
            building_id: r.get("building_id"),
            building_code: r.get("building_code"),
            building_name: r.get("building_name"),
            sub_meter_number: r.get("sub_meter_number"),
            previous_reading: r.get("previous_reading"),
            current_reading: r.get("current_reading"),
            total_consumption: r.get("total_consumption"),
        })
        .collect())
}

// ── Bill Generation ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct BillGenerationResult {
    pub bills_generated: i64,
    pub skipped: i64,
    pub errors: Vec<String>,
}

fn round2(n: f64) -> f64 {
    (n * 100.0).round() / 100.0
}

#[tauri::command]
pub async fn generate_bills_for_cycle(
    cycle_id: i64,
    state: State<'_, AppState>,
) -> Result<BillGenerationResult, String> {
    let caller = require_role(&["admin", "billing_staff"])?;
    let pool = state.db.lock().await;

    // Ensure cycle is in billing status
    let cycle = sqlx::query(
        "SELECT id, rate_per_cubicm, maynilad_prev, maynilad_curr,
                total_active_units_camres, status, period_start, period_end
         FROM billing_cycles WHERE id = ?"
    )
    .bind(cycle_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let cycle_status: String = cycle.get("status");
    if !["review_phase", "billing"].contains(&cycle_status.as_str()) {
        return Err(format!(
            "Cycle must be in review_phase or billing status to generate bills. Current: {}",
            cycle_status
        ));
    }

    let rate: f64 = cycle.get("rate_per_cubicm");
    let maynilad_prev: f64 = cycle.get::<Option<f64>, _>("maynilad_prev").unwrap_or(0.0);
    let maynilad_curr: f64 = cycle.get::<Option<f64>, _>("maynilad_curr").unwrap_or(0.0);
    let total_active_camres: i64 = cycle.get::<Option<i64>, _>("total_active_units_camres").unwrap_or(1);
    let period_end: String = cycle.get("period_end");

    let maynilad_total = (maynilad_curr - maynilad_prev).max(0.0);

    // Get all approved readings for this cycle
    let readings = sqlx::query(
        "SELECT mr.id, mr.unit_id, mr.previous_reading, mr.current_reading,
                mr.consumption, a.id as account_id, a.outstanding_balance,
                u.floor_id, f.building_id
         FROM meter_readings mr
         JOIN units u ON u.id = mr.unit_id
         JOIN floors f ON f.id = u.floor_id
         LEFT JOIN accounts a ON a.unit_id = mr.unit_id
         WHERE mr.billing_cycle_id = ? AND mr.status = 'approved'"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    // Group readings by building to compute system loss per building
    use std::collections::HashMap;
    let mut bldg_consumptions: HashMap<i64, f64> = HashMap::new();
    let mut bldg_active_units: HashMap<i64, i64> = HashMap::new();
    let mut sum_all_sub_meters: f64 = 0.0;

    // Fetch sub-meter readings per building
    let sub_readings = sqlx::query(
        "SELECT building_id, previous_reading, current_reading, total_consumption
         FROM bldg_sub_readings WHERE billing_cycle_id = ?"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut bldg_sub_meter: HashMap<i64, (f64, f64)> = HashMap::new();
    for sr in &sub_readings {
        let bldg_id: i64 = sr.get("building_id");
        let prev: f64 = sr.get("previous_reading");
        let curr: f64 = sr.get("current_reading");
        let consumption: f64 = sr.get("total_consumption");
        bldg_sub_meter.insert(bldg_id, (prev, curr));
        sum_all_sub_meters += consumption;
    }

    // Sum individual consumption per building
    for r in &readings {
        let bldg_id: i64 = r.get("building_id");
        let consumption: f64 = r.get::<Option<f64>, _>("consumption").unwrap_or(0.0);
        *bldg_consumptions.entry(bldg_id).or_insert(0.0) += consumption;
        *bldg_active_units.entry(bldg_id).or_insert(0) += 1;
    }

    // Community-level common system loss
    let common_loss_cum = (maynilad_total - sum_all_sub_meters).max(0.0);
    let common_loss_php = round2(common_loss_cum * rate);
    let common_loss_per_unit = round2(common_loss_php / total_active_camres as f64);

    let mut bills_generated: i64 = 0;
    let mut skipped: i64 = 0;
    let mut errors: Vec<String> = vec![];

    let due_date = compute_bill_due_date(parse_cycle_date(&period_end, "Cycle end date")?)?
        .format("%Y-%m-%d")
        .to_string();

    for r in &readings {
        let unit_id: i64 = r.get("unit_id");
        let account_id: Option<i64> = r.get("account_id");
        let bldg_id: i64 = r.get("building_id");

        let account_id = match account_id {
            Some(id) => id,
            None => {
                errors.push(format!("Unit {}: no account found, skipped", unit_id));
                skipped += 1;
                continue;
            }
        };

        let consumption: f64 = r.get::<Option<f64>, _>("consumption").unwrap_or(0.0);
        let prev_balance: f64 = r.get::<Option<f64>, _>("outstanding_balance").unwrap_or(0.0);

        // Water charge
        let water_charge = round2(consumption * rate);

        // Building system loss
        let (bldg_sub_prev, bldg_sub_curr) = bldg_sub_meter
            .get(&bldg_id)
            .copied()
            .unwrap_or((0.0, 0.0));
        let bldg_total = (bldg_sub_curr - bldg_sub_prev).max(0.0);
        let bldg_sum_units = bldg_consumptions.get(&bldg_id).copied().unwrap_or(0.0);
        let bldg_loss = (bldg_total - bldg_sum_units).max(0.0);
        let bldg_loss_php = round2(bldg_loss * rate);
        let active_in_bldg = bldg_active_units.get(&bldg_id).copied().unwrap_or(1);
        let sys_loss_per_unit = round2(bldg_loss_php / active_in_bldg as f64);

        let total_for_month = round2(water_charge + sys_loss_per_unit + common_loss_per_unit);
        let total_amount_due = round2(total_for_month + prev_balance);

        // Insert or update bill
        let result = sqlx::query(
            "INSERT INTO bills
             (account_id, billing_cycle_id, consumption_cubicm, water_charge,
              sys_loss_charge, common_sys_loss, previous_balance,
              total_for_month, total_amount_due, status, due_date, generated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
             ON CONFLICT(account_id, billing_cycle_id) DO UPDATE SET
             consumption_cubicm = excluded.consumption_cubicm,
             water_charge = excluded.water_charge,
             sys_loss_charge = excluded.sys_loss_charge,
             common_sys_loss = excluded.common_sys_loss,
             previous_balance = excluded.previous_balance,
             total_for_month = excluded.total_for_month,
             total_amount_due = excluded.total_amount_due,
             generated_by = excluded.generated_by"
        )
        .bind(account_id)
        .bind(cycle_id)
        .bind(consumption)
        .bind(water_charge)
        .bind(sys_loss_per_unit)
        .bind(common_loss_per_unit)
        .bind(prev_balance)
        .bind(total_for_month)
        .bind(total_amount_due)
        .bind(&due_date)
        .bind(caller.id)
        .execute(&*pool)
        .await;

        match result {
            Ok(_) => bills_generated += 1,
            Err(e) => {
                errors.push(format!("Unit {}: {}", unit_id, e));
                skipped += 1;
            }
        }
    }

    // Advance cycle status
    sqlx::query("UPDATE billing_cycles SET status = 'billing' WHERE id = ? AND status = 'review_phase'")
        .bind(cycle_id)
        .execute(&*pool)
        .await.ok();

    audit_log(&pool, caller.id, "GENERATE_BILLS", "bills", Some(cycle_id),
        &format!("Generated {} bills for cycle {}", bills_generated, cycle_id))
        .await.ok();

    Ok(BillGenerationResult { bills_generated, skipped, errors })
}

// ── Bill Queries ──────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct BillRow {
    pub id: i64,
    pub account_id: i64,
    pub account_number: String,
    pub resident_name: String,
    pub unit_number: String,
    pub building_code: String,
    pub billing_cycle_id: i64,
    pub period_start: String,
    pub period_end: String,
    pub consumption_cubicm: f64,
    pub water_charge: f64,
    pub sys_loss_charge: f64,
    pub common_sys_loss: f64,
    pub reconnection_fee: f64,
    pub penalty: f64,
    pub previous_balance: f64,
    pub total_for_month: f64,
    pub total_amount_due: f64,
    pub status: String,
    pub due_date: Option<String>,
    pub generated_at: String,
    pub rate_per_cubicm: f64,
    pub total_paid: f64,
    pub remaining_balance: f64,
    pub account_outstanding_balance: f64,
    pub payments_count: i64,
    pub latest_payment_id: Option<i64>,
    pub latest_receipt_number: Option<String>,
    pub latest_payment_date: Option<String>,
    pub disconnection_notice: String,
    pub disconnection_effective_date: Option<String>,
    pub disconnection_trigger_unpaid_bills: i64,
    pub unpaid_periods: i64,
    pub is_subject_for_disconnection: bool,
}

#[tauri::command]
pub async fn get_bill(bill_id: i64, state: State<'_, AppState>) -> Result<BillRow, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let r = sqlx::query(
        "SELECT b.*, a.account_number, a.resident_name, a.outstanding_balance,
                u.unit_number, bldg.code as building_code,
                bc.period_start, bc.period_end, bc.rate_per_cubicm,
                COALESCE((
                    SELECT CAST(SUM(p.amount_paid) AS REAL)
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                ), 0.0) as total_paid,
                (
                    SELECT COUNT(*)
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                ) as payments_count,
                (
                    SELECT p.id
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT 1
                ) as latest_payment_id,
                (
                    SELECT p.receipt_number
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT 1
                ) as latest_receipt_number,
                (
                    SELECT p.payment_date
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT 1
                ) as latest_payment_date
         FROM bills b
         JOIN accounts a ON a.id = b.account_id
         JOIN units u ON u.id = a.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings bldg ON bldg.id = f.building_id
         JOIN billing_cycles bc ON bc.id = b.billing_cycle_id
         WHERE b.id = ?"
    )
    .bind(bill_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let total_amount_due: f64 = r.get("total_amount_due");
    let total_paid: f64 = r.get("total_paid");
    let account_id: i64 = r.get("account_id");
    let period_end: String = r.get("period_end");
    let due_date = normalize_due_date(&period_end, r.get("due_date"))?;
    let disconnection = build_disconnection_policy(&pool, account_id).await?;
    let bill_notice = build_uniform_bill_notice(&pool).await?;

    Ok(BillRow {
        id: r.get("id"),
        account_id,
        account_number: r.get("account_number"),
        resident_name: r.get("resident_name"),
        unit_number: r.get("unit_number"),
        building_code: r.get("building_code"),
        billing_cycle_id: r.get("billing_cycle_id"),
        period_start: r.get("period_start"),
        period_end,
        consumption_cubicm: r.get("consumption_cubicm"),
        water_charge: r.get("water_charge"),
        sys_loss_charge: r.get("sys_loss_charge"),
        common_sys_loss: r.get("common_sys_loss"),
        reconnection_fee: r.get("reconnection_fee"),
        penalty: r.get("penalty"),
        previous_balance: r.get("previous_balance"),
        total_for_month: r.get("total_for_month"),
        total_amount_due,
        status: r.get("status"),
        due_date: Some(due_date),
        generated_at: r.get("generated_at"),
        rate_per_cubicm: r.get("rate_per_cubicm"),
        total_paid,
        remaining_balance: round2((total_amount_due - total_paid).max(0.0)),
        account_outstanding_balance: r.get("outstanding_balance"),
        payments_count: r.get("payments_count"),
        latest_payment_id: r.get("latest_payment_id"),
        latest_receipt_number: r.get("latest_receipt_number"),
        latest_payment_date: r.get("latest_payment_date"),
        disconnection_notice: bill_notice,
        disconnection_effective_date: disconnection.effective_date,
        disconnection_trigger_unpaid_bills: disconnection.trigger_unpaid_bills,
        unpaid_periods: disconnection.unpaid_periods,
        is_subject_for_disconnection: disconnection.is_eligible,
    })
}

#[tauri::command]
pub async fn list_bills_for_cycle(
    cycle_id: i64,
    status_filter: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BillRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let filter = status_filter.as_deref().unwrap_or("%");

    let rows = sqlx::query(
        "SELECT b.*, a.account_number, a.resident_name, a.outstanding_balance,
                u.unit_number, bldg.code as building_code,
                bc.period_start, bc.period_end, bc.rate_per_cubicm,
                COALESCE((
                    SELECT CAST(SUM(p.amount_paid) AS REAL)
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                ), 0.0) as total_paid,
                (
                    SELECT COUNT(*)
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                ) as payments_count,
                (
                    SELECT p.id
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT 1
                ) as latest_payment_id,
                (
                    SELECT p.receipt_number
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT 1
                ) as latest_receipt_number,
                (
                    SELECT p.payment_date
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT 1
                ) as latest_payment_date
         FROM bills b
         JOIN accounts a ON a.id = b.account_id
         JOIN units u ON u.id = a.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings bldg ON bldg.id = f.building_id
         JOIN billing_cycles bc ON bc.id = b.billing_cycle_id
         WHERE b.billing_cycle_id = ? AND (b.status LIKE ? OR ? = '%')
         ORDER BY bldg.code, u.unit_number"
    )
    .bind(cycle_id)
    .bind(filter)
    .bind(filter)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            let total_amount_due: f64 = r.get("total_amount_due");
            let total_paid: f64 = r.get("total_paid");
            let period_end: String = r.get("period_end");
            let due_date = normalize_due_date(&period_end, r.get("due_date"))
                .unwrap_or_else(|_| period_end.clone());

            BillRow {
                id: r.get("id"),
                account_id: r.get("account_id"),
                account_number: r.get("account_number"),
                resident_name: r.get("resident_name"),
                unit_number: r.get("unit_number"),
                building_code: r.get("building_code"),
                billing_cycle_id: r.get("billing_cycle_id"),
                period_start: r.get("period_start"),
                period_end,
                consumption_cubicm: r.get("consumption_cubicm"),
                water_charge: r.get("water_charge"),
                sys_loss_charge: r.get("sys_loss_charge"),
                common_sys_loss: r.get("common_sys_loss"),
                reconnection_fee: r.get("reconnection_fee"),
                penalty: r.get("penalty"),
                previous_balance: r.get("previous_balance"),
                total_for_month: r.get("total_for_month"),
                total_amount_due,
                status: r.get("status"),
                due_date: Some(due_date),
                generated_at: r.get("generated_at"),
                rate_per_cubicm: r.get("rate_per_cubicm"),
                total_paid,
                remaining_balance: round2((total_amount_due - total_paid).max(0.0)),
                account_outstanding_balance: r.get("outstanding_balance"),
                payments_count: r.get("payments_count"),
                latest_payment_id: r.get("latest_payment_id"),
                latest_receipt_number: r.get("latest_receipt_number"),
                latest_payment_date: r.get("latest_payment_date"),
                disconnection_notice: String::new(),
                disconnection_effective_date: None,
                disconnection_trigger_unpaid_bills: 0,
                unpaid_periods: 0,
                is_subject_for_disconnection: false,
            }
        })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct AccountBillPaymentRow {
    pub id: i64,
    pub billing_cycle_id: i64,
    pub period_start: String,
    pub period_end: String,
    pub status: String,
    pub due_date: Option<String>,
    pub previous_balance: f64,
    pub total_for_month: f64,
    pub total_amount_due: f64,
    pub total_paid_on_bill: f64,
    pub local_remaining_balance: f64,
    pub effective_open_balance: f64,
    pub is_oldest_open: bool,
}

#[tauri::command]
pub async fn list_bills_for_account(
    account_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<AccountBillPaymentRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT b.id, b.billing_cycle_id, b.status, b.due_date, b.previous_balance,
                b.total_for_month, b.total_amount_due, bc.period_start, bc.period_end,
                COALESCE((
                    SELECT CAST(SUM(p.amount_paid) AS REAL)
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                ), 0.0) as total_paid_on_bill
         FROM bills b
         JOIN billing_cycles bc ON bc.id = b.billing_cycle_id
         WHERE b.account_id = ?
         ORDER BY bc.period_start ASC, b.id ASC"
    )
    .bind(account_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let total_payments: f64 = sqlx::query_scalar(
        "SELECT COALESCE(CAST(SUM(p.amount_paid) AS REAL), 0.0)
         FROM payments p
         JOIN bills b ON b.id = p.bill_id
         WHERE b.account_id = ? AND p.is_void = 0"
    )
    .bind(account_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut remaining_payment_credit = round2(total_payments.max(0.0));
    let mut rows_out = Vec::with_capacity(rows.len());
    let mut oldest_open_seen = false;

    for row in rows {
        let total_for_month: f64 = row.get("total_for_month");
        let local_remaining_balance =
            round2((row.get::<f64, _>("total_amount_due") - row.get::<f64, _>("total_paid_on_bill")).max(0.0));

        let effective_open_balance = if remaining_payment_credit >= total_for_month {
            remaining_payment_credit = round2(remaining_payment_credit - total_for_month);
            0.0
        } else {
            let open = round2(total_for_month - remaining_payment_credit);
            remaining_payment_credit = 0.0;
            open
        };

        let is_oldest_open = effective_open_balance > 0.0 && !oldest_open_seen;
        if is_oldest_open {
            oldest_open_seen = true;
        }

        rows_out.push(AccountBillPaymentRow {
            id: row.get("id"),
            billing_cycle_id: row.get("billing_cycle_id"),
            period_start: row.get("period_start"),
            period_end: row.get("period_end"),
            status: row.get("status"),
            due_date: row.get("due_date"),
            previous_balance: row.get("previous_balance"),
            total_for_month,
            total_amount_due: row.get("total_amount_due"),
            total_paid_on_bill: row.get("total_paid_on_bill"),
            local_remaining_balance,
            effective_open_balance,
            is_oldest_open,
        });
    }

    Ok(rows_out)
}
