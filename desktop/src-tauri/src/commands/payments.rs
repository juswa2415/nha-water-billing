// src-tauri/src/commands/payments.rs

use crate::commands::auth::require_role;
use crate::db::connection::{AppState, audit_log, get_setting, set_setting};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

fn round2(n: f64) -> f64 {
    (n * 100.0).round() / 100.0
}

// ── Receipt Number ────────────────────────────────────────────────

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

    // Increment — use a dummy user_id 0 for system operations
    set_setting(pool, "receipt_next_number", &(next + 1).to_string(), user_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("{}{:07}", prefix, next))
}

// ── Payment Recording ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RecordPaymentRequest {
    pub bill_id: i64,
    pub amount_paid: f64,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub payment_method: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PaymentResult {
    pub payment_id: i64,
    pub receipt_number: String,
    pub remaining_balance: f64,
}

#[tauri::command]
pub async fn record_payment(
    payload: RecordPaymentRequest,
    state: State<'_, AppState>,
) -> Result<PaymentResult, String> {
    let caller = require_role(&["admin", "cashier"])?;
    let pool = state.db.lock().await;

    // Fetch the bill
    let bill = sqlx::query(
        "SELECT b.id, b.total_amount_due, b.status, b.account_id,
                a.outstanding_balance
         FROM bills b
         JOIN accounts a ON a.id = b.account_id
         WHERE b.id = ?"
    )
    .bind(payload.bill_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let bill_status: String = bill.get("status");
    if bill_status == "locked" {
        return Err("Cannot record payment: bill is locked.".to_string());
    }

    let total_due: f64 = bill.get("total_amount_due");
    let account_id: i64 = bill.get("account_id");

    // Check existing payments on this bill
    let already_paid: f64 = sqlx::query_scalar(
        "SELECT COALESCE(CAST(SUM(amount_paid) AS REAL), 0.0) FROM payments
         WHERE bill_id = ? AND is_void = 0"
    )
    .bind(payload.bill_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let effective_due = round2(total_due - already_paid);
    if effective_due <= 0.0 {
        return Err("This bill is already fully paid.".to_string());
    }

    if payload.amount_paid <= 0.0 {
        return Err("Payment amount must be greater than zero.".to_string());
    }

    let applied_amount = round2(payload.amount_paid.min(effective_due));
    let remaining = round2(effective_due - applied_amount);

    let receipt_number = generate_receipt_number(&pool, Some(caller.id)).await?;
    let payment_method = payload.payment_method.as_deref().unwrap_or("cash");

    let payment_id = sqlx::query(
        "INSERT INTO payments
         (bill_id, received_by, amount_paid, remaining_balance, receipt_number,
          payment_date, period_start, period_end, payment_method)
         VALUES (?, ?, ?, ?, ?, date('now'), ?, ?, ?)"
    )
    .bind(payload.bill_id)
    .bind(caller.id)
    .bind(applied_amount)
    .bind(remaining.max(0.0))
    .bind(&receipt_number)
    .bind(&payload.period_start)
    .bind(&payload.period_end)
    .bind(payment_method)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    // Update account outstanding balance
    let new_balance = remaining.max(0.0);
    sqlx::query("UPDATE accounts SET outstanding_balance = ? WHERE id = ?")
        .bind(new_balance)
        .bind(account_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    // Update bill status to finalized if fully paid
    if remaining <= 0.0 {
        sqlx::query("UPDATE bills SET status = 'finalized' WHERE id = ?")
            .bind(payload.bill_id)
            .execute(&*pool)
            .await.ok();
    }

    audit_log(
        &pool, caller.id, "RECORD_PAYMENT", "payments", Some(payment_id),
        &format!("Receipt {}: ₱{:.2} for bill {}", receipt_number, payload.amount_paid, payload.bill_id),
    ).await.ok();

    Ok(PaymentResult {
        payment_id,
        receipt_number,
        remaining_balance: remaining.max(0.0),
    })
}

// ── Payment Queries ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PaymentRow {
    pub id: i64,
    pub bill_id: i64,
    pub received_by: String,
    pub amount_paid: f64,
    pub remaining_balance: f64,
    pub receipt_number: String,
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

    let r = sqlx::query(
        "SELECT p.*, u.full_name as received_by
         FROM payments p
         JOIN users u ON u.id = p.received_by
         WHERE p.id = ?"
    )
    .bind(payment_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(map_payment_row(&r))
}

#[tauri::command]
pub async fn list_payments_for_bill(
    bill_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<PaymentRow>, String> {
    require_role(&["admin", "cashier", "billing_staff"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
         "SELECT p.*, u.full_name as received_by
         FROM payments p
         JOIN users u ON u.id = p.received_by
         WHERE p.bill_id = ?
         ORDER BY p.created_at DESC, p.id DESC"
    )
    .bind(bill_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(map_payment_row).collect())
}

fn map_payment_row(r: &sqlx::sqlite::SqliteRow) -> PaymentRow {
    PaymentRow {
        id: r.get("id"),
        bill_id: r.get("bill_id"),
        received_by: r.get("received_by"),
        amount_paid: r.get("amount_paid"),
        remaining_balance: r.get("remaining_balance"),
        receipt_number: r.get("receipt_number"),
        payment_date: r.get("payment_date"),
        period_start: r.get("period_start"),
        period_end: r.get("period_end"),
        payment_method: r.get("payment_method"),
        is_void: r.get::<i64, _>("is_void") == 1,
        void_reason: r.get("void_reason"),
        void_at: r.get("void_at"),
        created_at: r.get("created_at"),
    }
}

// ── Void / Reversal ───────────────────────────────────────────────

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
    let caller = require_role(&["admin"])?; // Admin-only
    let pool = state.db.lock().await;

    let payment = sqlx::query(
        "SELECT p.id, p.bill_id, p.amount_paid, p.is_void, b.account_id
         FROM payments p JOIN bills b ON b.id = p.bill_id
         WHERE p.id = ?"
    )
    .bind(payload.payment_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let is_void: i64 = payment.get("is_void");
    if is_void == 1 {
        return Err("Payment is already voided.".to_string());
    }

    let amount_paid: f64 = payment.get("amount_paid");
    let bill_id: i64 = payment.get("bill_id");
    let account_id: i64 = payment.get("account_id");

    // Mark void
    sqlx::query(
        "UPDATE payments SET is_void = 1, void_reason = ?,
         void_approved_by = ?, void_at = datetime('now')
         WHERE id = ?"
    )
    .bind(&payload.void_reason)
    .bind(caller.id)
    .bind(payload.payment_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    // Restore outstanding balance
    sqlx::query(
        "UPDATE accounts SET outstanding_balance = outstanding_balance + ? WHERE id = ?"
    )
    .bind(amount_paid)
    .bind(account_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    // Revert bill status to draft if needed
    sqlx::query(
        "UPDATE bills SET status = 'draft' WHERE id = ? AND status = 'finalized'"
    )
    .bind(bill_id)
    .execute(&*pool)
    .await.ok();

    audit_log(
        &pool, caller.id, "VOID_PAYMENT", "payments", Some(payload.payment_id),
        &format!("Voided: {} | Reason: {}", amount_paid, payload.void_reason),
    ).await.ok();

    Ok(())
}
