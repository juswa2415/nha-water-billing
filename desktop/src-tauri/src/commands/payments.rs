use crate::commands::auth::require_role;
use crate::db::connection::{audit_log, get_setting, set_setting, AppState};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

fn round2(n: f64) -> f64 {
    let rounded = (n * 100.0).round() / 100.0;
    if rounded.abs() < 0.005 {
        0.0
    } else {
        rounded
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

async fn refresh_bill_status(pool: &sqlx::SqlitePool, bill_id: i64) -> Result<(), String> {
    let row = sqlx::query(
        "SELECT b.total_amount_due, b.status,
                COALESCE((
                    SELECT CAST(SUM(p.amount_paid) AS REAL)
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                ), 0.0) as total_paid
         FROM bills b
         WHERE b.id = ?",
    )
    .bind(bill_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let current_status: String = row.get("status");
    if current_status == "locked" {
        return Ok(());
    }

    let total_amount_due: f64 = row.get("total_amount_due");
    let total_paid: f64 = row.get("total_paid");
    let next_status = if round2(total_paid) >= round2(total_amount_due) {
        "finalized"
    } else {
        "draft"
    };

    sqlx::query("UPDATE bills SET status = ? WHERE id = ?")
        .bind(next_status)
        .bind(bill_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_next_receipt_number(state: State<'_, AppState>) -> Result<String, String> {
    let caller = require_role(&["admin", "cashier"])?;
    let pool = state.db.lock().await;
    generate_receipt_number(&pool, Some(caller.id)).await
}

async fn generate_receipt_number(
    pool: &sqlx::SqlitePool,
    user_id: Option<i64>,
) -> Result<String, String> {
    let next_str = get_setting(pool, "receipt_next_number")
        .await
        .unwrap_or_else(|_| "1".to_string());
    let next: i64 = next_str.parse().unwrap_or(1);
    let prefix = get_setting(pool, "receipt_prefix").await.unwrap_or_default();

    set_setting(pool, "receipt_next_number", &(next + 1).to_string(), user_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("{}{:07}", prefix, next))
}

#[derive(Debug)]
struct OpenBillTarget {
    bill_id: i64,
    period_start: String,
    period_end: String,
    total_amount_due: f64,
    already_paid_on_bill: f64,
    effective_open_balance: f64,
}

#[derive(Debug)]
struct AllocationPlanRow {
    bill_id: i64,
    period_start: String,
    period_end: String,
    allocation: f64,
    local_remaining_after: f64,
}

#[derive(Debug, Deserialize)]
pub struct RecordPaymentRequest {
    pub bill_id: i64,
    pub amount_paid: f64,
    pub payment_method: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PaymentResult {
    pub payment_id: i64,
    pub receipt_number: String,
    pub remaining_balance: f64,
    pub allocations_count: i64,
}

#[tauri::command]
pub async fn record_payment(
    payload: RecordPaymentRequest,
    state: State<'_, AppState>,
) -> Result<PaymentResult, String> {
    let caller = require_role(&["admin", "cashier"])?;
    let pool = state.db.lock().await;

    let bill = sqlx::query(
        "SELECT b.id, b.status, b.account_id
         FROM bills b
         WHERE b.id = ?",
    )
    .bind(payload.bill_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let bill_status: String = bill.get("status");
    if bill_status == "locked" {
        return Err("Cannot record payment: bill is locked.".to_string());
    }

    if payload.amount_paid <= 0.0 {
        return Err("Payment amount must be greater than zero.".to_string());
    }

    let payment_method = payload.payment_method.as_deref().unwrap_or("cash");
    if payment_method != "cash" {
        return Err("Only cash payments are enabled right now.".to_string());
    }

    let account_id: i64 = bill.get("account_id");

    let bill_rows = sqlx::query(
        "SELECT b.id, b.total_amount_due, b.total_for_month,
                bc.period_start, bc.period_end,
                COALESCE((
                    SELECT CAST(SUM(p.amount_paid) AS REAL)
                    FROM payments p
                    WHERE p.bill_id = b.id AND p.is_void = 0
                ), 0.0) as already_paid_on_bill
         FROM bills b
         JOIN billing_cycles bc ON bc.id = b.billing_cycle_id
         WHERE b.account_id = ?
         ORDER BY bc.period_start ASC, b.id ASC",
    )
    .bind(account_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let total_paid_before: f64 = sqlx::query_scalar(
        "SELECT COALESCE(CAST(SUM(p.amount_paid) AS REAL), 0.0)
         FROM payments p
         JOIN bills b ON b.id = p.bill_id
         WHERE b.account_id = ? AND p.is_void = 0",
    )
    .bind(account_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut remaining_credit_before = round2(total_paid_before.max(0.0));
    let mut open_targets = Vec::new();

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

        open_targets.push(OpenBillTarget {
            bill_id: row.get("id"),
            period_start: row.get("period_start"),
            period_end: row.get("period_end"),
            total_amount_due: row.get("total_amount_due"),
            already_paid_on_bill: row.get("already_paid_on_bill"),
            effective_open_balance,
        });
    }

    if open_targets.is_empty() {
        return Err("This account has no open balance.".to_string());
    }

    let mut remaining_to_allocate = round2(payload.amount_paid);
    let mut allocation_plan: Vec<AllocationPlanRow> = Vec::new();

    for (index, target) in open_targets.iter().enumerate() {
        if remaining_to_allocate <= 0.0 {
            break;
        }

        let is_last_open = index == open_targets.len() - 1;
        let planned_allocation = if is_last_open && remaining_to_allocate > target.effective_open_balance {
            remaining_to_allocate
        } else {
            remaining_to_allocate.min(target.effective_open_balance)
        };

        if planned_allocation <= 0.0 {
            continue;
        }

        let local_remaining_after = round2(
            target.total_amount_due - (target.already_paid_on_bill + planned_allocation),
        );

        allocation_plan.push(AllocationPlanRow {
            bill_id: target.bill_id,
            period_start: target.period_start.clone(),
            period_end: target.period_end.clone(),
            allocation: planned_allocation,
            local_remaining_after,
        });

        remaining_to_allocate = round2(remaining_to_allocate - planned_allocation);
    }

    if allocation_plan.is_empty() {
        return Err("There is no amount available to allocate.".to_string());
    }

    let receipt_group_number = generate_receipt_number(&pool, Some(caller.id)).await?;
    let mut affected_bill_ids = Vec::new();
    let mut first_payment_id: Option<i64> = None;

    for (index, plan) in allocation_plan.iter().enumerate() {
        let line_receipt_number = if index == 0 {
            receipt_group_number.clone()
        } else {
            generate_receipt_number(&pool, Some(caller.id)).await?
        };

        let payment_id = sqlx::query(
            "INSERT INTO payments
             (bill_id, received_by, amount_paid, remaining_balance, receipt_number,
              receipt_group_number, account_balance_after, payment_date,
              period_start, period_end, payment_method)
             VALUES (?, ?, ?, ?, ?, ?, 0, date('now'), ?, ?, ?)",
        )
        .bind(plan.bill_id)
        .bind(caller.id)
        .bind(plan.allocation)
        .bind(plan.local_remaining_after)
        .bind(&line_receipt_number)
        .bind(&receipt_group_number)
        .bind(&plan.period_start)
        .bind(&plan.period_end)
        .bind(payment_method)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?
        .last_insert_rowid();

        if first_payment_id.is_none() {
            first_payment_id = Some(payment_id);
        }

        affected_bill_ids.push(plan.bill_id);
    }

    let new_balance = recompute_account_outstanding_balance(&pool, account_id).await?;

    sqlx::query(
        "UPDATE payments
         SET account_balance_after = ?
         WHERE receipt_group_number = ?",
    )
    .bind(new_balance)
    .bind(&receipt_group_number)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    for bill_id in affected_bill_ids {
        refresh_bill_status(&pool, bill_id).await?;
    }

    audit_log(
        &pool,
        caller.id,
        "RECORD_PAYMENT",
        "payments",
        first_payment_id,
        &format!(
            "Receipt {} posted across {} bill(s) for account {} totaling PHP {:.2}",
            receipt_group_number,
            allocation_plan.len(),
            account_id,
            payload.amount_paid
        ),
    )
    .await
    .ok();

    Ok(PaymentResult {
        payment_id: first_payment_id.unwrap_or_default(),
        receipt_number: receipt_group_number,
        remaining_balance: new_balance,
        allocations_count: allocation_plan.len() as i64,
    })
}

#[derive(Debug, Serialize)]
pub struct PaymentRow {
    pub id: i64,
    pub bill_id: i64,
    pub received_by: String,
    pub amount_paid: f64,
    pub remaining_balance: f64,
    pub account_balance_after: f64,
    pub receipt_number: String,
    pub receipt_group_number: String,
    pub payment_date: String,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub payment_method: String,
    pub is_void: bool,
    pub void_reason: Option<String>,
    pub void_at: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub async fn get_payment(
    payment_id: i64,
    state: State<'_, AppState>,
) -> Result<PaymentRow, String> {
    require_role(&["admin", "cashier", "billing_staff"])?;
    let pool = state.db.lock().await;

    let row = sqlx::query(
        "SELECT p.*, u.full_name as received_by,
                COALESCE(NULLIF(p.receipt_group_number, ''), p.receipt_number) as receipt_group_number
         FROM payments p
         JOIN users u ON u.id = p.received_by
         WHERE p.id = ?",
    )
    .bind(payment_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(map_payment_row(&row))
}

#[tauri::command]
pub async fn list_payments_for_bill(
    bill_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<PaymentRow>, String> {
    require_role(&["admin", "cashier", "billing_staff"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT p.*, u.full_name as received_by,
                COALESCE(NULLIF(p.receipt_group_number, ''), p.receipt_number) as receipt_group_number
         FROM payments p
         JOIN users u ON u.id = p.received_by
         WHERE p.bill_id = ?
         ORDER BY p.created_at DESC, p.id DESC",
    )
    .bind(bill_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(map_payment_row).collect())
}

#[tauri::command]
pub async fn list_payments_for_receipt_group(
    receipt_group_number: String,
    state: State<'_, AppState>,
) -> Result<Vec<PaymentRow>, String> {
    require_role(&["admin", "cashier", "billing_staff"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT p.*, u.full_name as received_by,
                COALESCE(NULLIF(p.receipt_group_number, ''), p.receipt_number) as receipt_group_number
         FROM payments p
         JOIN users u ON u.id = p.received_by
         WHERE COALESCE(NULLIF(p.receipt_group_number, ''), p.receipt_number) = ?
         ORDER BY p.created_at ASC, p.id ASC",
    )
    .bind(&receipt_group_number)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(map_payment_row).collect())
}

fn map_payment_row(row: &sqlx::sqlite::SqliteRow) -> PaymentRow {
    PaymentRow {
        id: row.get("id"),
        bill_id: row.get("bill_id"),
        received_by: row.get("received_by"),
        amount_paid: row.get("amount_paid"),
        remaining_balance: row.get("remaining_balance"),
        account_balance_after: row.get("account_balance_after"),
        receipt_number: row.get("receipt_number"),
        receipt_group_number: row.get("receipt_group_number"),
        payment_date: row.get("payment_date"),
        period_start: row.get("period_start"),
        period_end: row.get("period_end"),
        payment_method: row.get("payment_method"),
        is_void: row.get::<i64, _>("is_void") == 1,
        void_reason: row.get("void_reason"),
        void_at: row.get("void_at"),
        created_at: row.get("created_at"),
    }
}

#[derive(Debug, Deserialize)]
pub struct VoidPaymentRequest {
    pub payment_id: i64,
    pub void_reason: String,
}

#[tauri::command]
pub async fn void_payment(
    payload: VoidPaymentRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    let payment = sqlx::query(
        "SELECT p.id, p.bill_id, p.is_void, b.account_id,
                COALESCE(NULLIF(p.receipt_group_number, ''), p.receipt_number) as receipt_group_number
         FROM payments p
         JOIN bills b ON b.id = p.bill_id
         WHERE p.id = ?",
    )
    .bind(payload.payment_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let is_void: i64 = payment.get("is_void");
    if is_void == 1 {
        return Err("Payment is already voided.".to_string());
    }

    let account_id: i64 = payment.get("account_id");
    let receipt_group_number: String = payment.get("receipt_group_number");

    let affected_rows = sqlx::query(
        "SELECT bill_id
         FROM payments
         WHERE COALESCE(NULLIF(receipt_group_number, ''), receipt_number) = ?",
    )
    .bind(&receipt_group_number)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE payments
         SET is_void = 1,
             void_reason = ?,
             void_approved_by = ?,
             void_at = datetime('now')
         WHERE COALESCE(NULLIF(receipt_group_number, ''), receipt_number) = ?",
    )
    .bind(&payload.void_reason)
    .bind(caller.id)
    .bind(&receipt_group_number)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    recompute_account_outstanding_balance(&pool, account_id).await?;

    for row in affected_rows {
        let bill_id: i64 = row.get("bill_id");
        refresh_bill_status(&pool, bill_id).await?;
    }

    audit_log(
        &pool,
        caller.id,
        "VOID_PAYMENT",
        "payments",
        Some(payload.payment_id),
        &format!(
            "Voided receipt group {} | Reason: {}",
            receipt_group_number, payload.void_reason
        ),
    )
    .await
    .ok();

    Ok(())
}
