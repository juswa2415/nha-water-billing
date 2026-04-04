use crate::commands::auth::require_role;
use crate::db::connection::AppState;
use serde::Serialize;
use sqlx::Row;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct BillingSummaryRow {
    pub building_code: String,
    pub total_bills: i64,
    pub total_amount_due: f64,
    pub total_collected: f64,
    pub total_outstanding: f64,
    pub fully_paid: i64,
    pub partially_paid: i64,
    pub unpaid: i64,
}

#[tauri::command]
pub async fn billing_summary(
    cycle_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<BillingSummaryRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT bldg.code AS building_code,
                COUNT(b.id) AS total_bills,
                COALESCE(CAST(SUM(b.total_amount_due) AS REAL), 0.0) AS total_amount_due,
                COALESCE(CAST(SUM(COALESCE(p.total_paid, 0.0)) AS REAL), 0.0) AS total_collected,
                COALESCE(CAST(SUM(MAX(b.total_amount_due - COALESCE(p.total_paid, 0.0), 0.0)) AS REAL), 0.0) AS total_outstanding,
                SUM(CASE WHEN COALESCE(p.total_paid, 0.0) >= b.total_amount_due AND COALESCE(p.total_paid, 0.0) > 0 THEN 1 ELSE 0 END) AS fully_paid,
                SUM(CASE WHEN COALESCE(p.total_paid, 0.0) > 0 AND COALESCE(p.total_paid, 0.0) < b.total_amount_due THEN 1 ELSE 0 END) AS partially_paid,
                SUM(CASE WHEN COALESCE(p.total_paid, 0.0) = 0 THEN 1 ELSE 0 END) AS unpaid
         FROM bills b
         JOIN accounts a ON a.id = b.account_id
         JOIN units u ON u.id = a.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings bldg ON bldg.id = f.building_id
         LEFT JOIN (
            SELECT bill_id, COALESCE(CAST(SUM(amount_paid) AS REAL), 0.0) AS total_paid
            FROM payments
            WHERE is_void = 0
            GROUP BY bill_id
         ) p ON p.bill_id = b.id
         WHERE b.billing_cycle_id = ?
         GROUP BY bldg.code
         ORDER BY bldg.code"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| BillingSummaryRow {
            building_code: r.get("building_code"),
            total_bills: r.get("total_bills"),
            total_amount_due: r.get("total_amount_due"),
            total_collected: r.get("total_collected"),
            total_outstanding: r.get("total_outstanding"),
            fully_paid: r.get("fully_paid"),
            partially_paid: r.get("partially_paid"),
            unpaid: r.get("unpaid"),
        })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct CollectionRow {
    pub payment_id: i64,
    pub payment_date: String,
    pub receipt_number: String,
    pub unit_number: String,
    pub building_code: String,
    pub resident_name: String,
    pub amount_paid: f64,
    pub received_by: String,
    pub payment_method: String,
}

#[tauri::command]
pub async fn collection_summary(
    cycle_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<CollectionRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT p.id AS payment_id, p.payment_date, p.receipt_number, u.unit_number, bldg.code AS building_code,
                a.resident_name, p.amount_paid, cash.full_name AS received_by, p.payment_method
         FROM payments p
         JOIN bills b ON b.id = p.bill_id
         JOIN accounts a ON a.id = b.account_id
         JOIN units u ON u.id = a.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings bldg ON bldg.id = f.building_id
         JOIN users cash ON cash.id = p.received_by
         WHERE b.billing_cycle_id = ? AND p.is_void = 0
         ORDER BY p.payment_date DESC, p.receipt_number DESC"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| CollectionRow {
            payment_id: r.get("payment_id"),
            payment_date: r.get("payment_date"),
            receipt_number: r.get("receipt_number"),
            unit_number: r.get("unit_number"),
            building_code: r.get("building_code"),
            resident_name: r.get("resident_name"),
            amount_paid: r.get("amount_paid"),
            received_by: r.get("received_by"),
            payment_method: r.get("payment_method"),
        })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct UnpaidAccountRow {
    pub bill_id: i64,
    pub unit_number: String,
    pub building_code: String,
    pub resident_name: String,
    pub account_number: String,
    pub total_amount_due: f64,
    pub outstanding_balance: f64,
    pub due_date: Option<String>,
}

#[tauri::command]
pub async fn unpaid_accounts(
    cycle_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<UnpaidAccountRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT b.id AS bill_id, u.unit_number, bldg.code AS building_code, a.resident_name,
                a.account_number, b.total_amount_due,
                MAX(b.total_amount_due - COALESCE(p.total_paid, 0.0), 0.0) AS outstanding_balance,
                b.due_date
         FROM bills b
         JOIN accounts a ON a.id = b.account_id
         JOIN units u ON u.id = a.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings bldg ON bldg.id = f.building_id
         LEFT JOIN (
            SELECT bill_id, COALESCE(CAST(SUM(amount_paid) AS REAL), 0.0) AS total_paid
            FROM payments
            WHERE is_void = 0
            GROUP BY bill_id
         ) p ON p.bill_id = b.id
         WHERE b.billing_cycle_id = ?
           AND MAX(b.total_amount_due - COALESCE(p.total_paid, 0.0), 0.0) > 0
         ORDER BY outstanding_balance DESC, bldg.code, u.unit_number"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| UnpaidAccountRow {
            bill_id: r.get("bill_id"),
            unit_number: r.get("unit_number"),
            building_code: r.get("building_code"),
            resident_name: r.get("resident_name"),
            account_number: r.get("account_number"),
            total_amount_due: r.get("total_amount_due"),
            outstanding_balance: r.get("outstanding_balance"),
            due_date: r.get("due_date"),
        })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct AgingRow {
    pub unit_number: String,
    pub building_code: String,
    pub resident_name: String,
    pub current_balance: f64,
    pub overdue_30: f64,
    pub overdue_60: f64,
    pub overdue_90_plus: f64,
    pub total_outstanding: f64,
}

#[tauri::command]
pub async fn aging_report(state: State<'_, AppState>) -> Result<Vec<AgingRow>, String> {
    require_role(&["admin", "billing_staff", "cashier"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT u.unit_number, bldg.code AS building_code, a.resident_name,
                COALESCE(CAST(SUM(CASE WHEN balance.overdue_days <= 30 THEN balance.outstanding ELSE 0.0 END) AS REAL), 0.0) AS current_balance,
                COALESCE(CAST(SUM(CASE WHEN balance.overdue_days > 30 AND balance.overdue_days <= 60 THEN balance.outstanding ELSE 0.0 END) AS REAL), 0.0) AS overdue_30,
                COALESCE(CAST(SUM(CASE WHEN balance.overdue_days > 60 AND balance.overdue_days <= 90 THEN balance.outstanding ELSE 0.0 END) AS REAL), 0.0) AS overdue_60,
                COALESCE(CAST(SUM(CASE WHEN balance.overdue_days > 90 THEN balance.outstanding ELSE 0.0 END) AS REAL), 0.0) AS overdue_90_plus,
                COALESCE(CAST(SUM(balance.outstanding) AS REAL), 0.0) AS total_outstanding
         FROM (
            SELECT b.account_id,
                   MAX(b.total_amount_due - COALESCE(p.total_paid, 0.0), 0.0) AS outstanding,
                   CAST(MAX(julianday('now') - julianday(COALESCE(b.due_date, b.generated_at)), 0.0) AS INTEGER) AS overdue_days
            FROM bills b
            LEFT JOIN (
                SELECT bill_id, COALESCE(CAST(SUM(amount_paid) AS REAL), 0.0) AS total_paid
                FROM payments
                WHERE is_void = 0
                GROUP BY bill_id
            ) p ON p.bill_id = b.id
         ) balance
         JOIN accounts a ON a.id = balance.account_id
         JOIN units u ON u.id = a.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings bldg ON bldg.id = f.building_id
         WHERE balance.outstanding > 0
         GROUP BY a.id, bldg.code, u.unit_number, a.resident_name
         ORDER BY total_outstanding DESC, bldg.code, u.unit_number"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| AgingRow {
            unit_number: r.get("unit_number"),
            building_code: r.get("building_code"),
            resident_name: r.get("resident_name"),
            current_balance: r.get("current_balance"),
            overdue_30: r.get("overdue_30"),
            overdue_60: r.get("overdue_60"),
            overdue_90_plus: r.get("overdue_90_plus"),
            total_outstanding: r.get("total_outstanding"),
        })
        .collect())
}
