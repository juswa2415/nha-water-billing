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

    let base_rows = sqlx::query(
        "SELECT bldg.code AS building_code,
                COUNT(b.id) AS total_bills,
                COALESCE(CAST(SUM(b.total_amount_due) AS REAL), 0.0) AS total_amount_due,
                COALESCE(CAST(SUM(COALESCE(p.total_paid, 0.0)) AS REAL), 0.0) AS total_collected,
                COALESCE(CAST(SUM(MAX(b.total_amount_due - COALESCE(p.total_paid, 0.0), 0.0)) AS REAL), 0.0) AS total_outstanding
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

    let status_rows = sqlx::query(
        "SELECT b.account_id,
                b.billing_cycle_id,
                b.total_for_month,
                bldg.code AS building_code,
                bc.period_start
         FROM bills b
         JOIN billing_cycles bc ON bc.id = b.billing_cycle_id
         JOIN accounts a ON a.id = b.account_id
         JOIN units u ON u.id = a.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings bldg ON bldg.id = f.building_id
         WHERE b.account_id IN (
            SELECT account_id FROM bills WHERE billing_cycle_id = ?
         )
         ORDER BY b.account_id, bc.period_start ASC, b.id ASC"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let payment_rows = sqlx::query(
        "SELECT b.account_id,
                COALESCE(CAST(SUM(p.amount_paid) AS REAL), 0.0) AS total_paid
         FROM bills b
         LEFT JOIN payments p ON p.bill_id = b.id AND p.is_void = 0
         WHERE b.account_id IN (
            SELECT account_id FROM bills WHERE billing_cycle_id = ?
         )
         GROUP BY b.account_id"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut total_paid_by_account = std::collections::HashMap::new();
    for row in payment_rows {
        total_paid_by_account.insert(row.get::<i64, _>("account_id"), row.get::<f64, _>("total_paid"));
    }

    let mut status_counts: std::collections::HashMap<String, (i64, i64, i64)> =
        std::collections::HashMap::new();
    let mut current_account: Option<i64> = None;
    let mut remaining_credit = 0.0;
    let mut total_paid_for_account = 0.0;

    for row in status_rows {
        let account_id: i64 = row.get("account_id");
        if current_account != Some(account_id) {
            current_account = Some(account_id);
            total_paid_for_account = *total_paid_by_account.get(&account_id).unwrap_or(&0.0);
            remaining_credit = total_paid_for_account;
        }

        let total_for_month: f64 = row.get("total_for_month");
        let effective_open = if remaining_credit >= total_for_month {
            remaining_credit -= total_for_month;
            0.0
        } else {
            let open = total_for_month - remaining_credit;
            remaining_credit = 0.0;
            open
        };

        let bill_cycle_id: i64 = row.get("billing_cycle_id");
        if bill_cycle_id != cycle_id {
            continue;
        }

        let entry = status_counts
            .entry(row.get::<String, _>("building_code"))
            .or_insert((0, 0, 0));

        if total_paid_for_account <= 0.0 {
            entry.2 += 1;
        } else if effective_open <= 0.0 {
            entry.0 += 1;
        } else {
            entry.1 += 1;
        }
    }

    Ok(base_rows
        .iter()
        .map(|r| {
            let building_code: String = r.get("building_code");
            let (fully_paid, partially_paid, unpaid) = status_counts
                .get(&building_code)
                .copied()
                .unwrap_or((0, 0, 0));

            BillingSummaryRow {
                building_code,
                total_bills: r.get("total_bills"),
                total_amount_due: r.get("total_amount_due"),
                total_collected: r.get("total_collected"),
                total_outstanding: r.get("total_outstanding"),
                fully_paid,
                partially_paid,
                unpaid,
            }
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
        "SELECT MIN(p.id) AS payment_id,
                MAX(p.payment_date) AS payment_date,
                COALESCE(NULLIF(p.receipt_group_number, ''), p.receipt_number) AS receipt_number,
                MAX(u.unit_number) AS unit_number,
                MAX(bldg.code) AS building_code,
                MAX(a.resident_name) AS resident_name,
                COALESCE(CAST(SUM(p.amount_paid) AS REAL), 0.0) AS amount_paid,
                MAX(cash.full_name) AS received_by,
                MAX(p.payment_method) AS payment_method
         FROM payments p
         JOIN bills b ON b.id = p.bill_id
         JOIN accounts a ON a.id = b.account_id
         JOIN units u ON u.id = a.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings bldg ON bldg.id = f.building_id
         JOIN users cash ON cash.id = p.received_by
         WHERE b.billing_cycle_id = ? AND p.is_void = 0
         GROUP BY COALESCE(NULLIF(p.receipt_group_number, ''), p.receipt_number)
         ORDER BY MAX(p.payment_date) DESC, COALESCE(NULLIF(p.receipt_group_number, ''), p.receipt_number) DESC"
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

    let bill_rows = sqlx::query(
        "SELECT b.id AS bill_id,
                b.account_id,
                b.billing_cycle_id,
                b.total_for_month,
                b.total_amount_due,
                b.due_date,
                bc.period_start,
                a.account_number,
                a.resident_name,
                u.unit_number,
                bldg.code AS building_code
         FROM bills b
         JOIN billing_cycles bc ON bc.id = b.billing_cycle_id
         JOIN accounts a ON a.id = b.account_id
         JOIN units u ON u.id = a.unit_id
         JOIN floors f ON f.id = u.floor_id
         JOIN buildings bldg ON bldg.id = f.building_id
         WHERE b.account_id IN (
            SELECT account_id FROM bills WHERE billing_cycle_id = ?
         )
         ORDER BY b.account_id, bc.period_start ASC, b.id ASC"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let payment_rows = sqlx::query(
        "SELECT b.account_id,
                COALESCE(CAST(SUM(p.amount_paid) AS REAL), 0.0) AS total_paid
         FROM bills b
         LEFT JOIN payments p ON p.bill_id = b.id AND p.is_void = 0
         WHERE b.account_id IN (
            SELECT account_id FROM bills WHERE billing_cycle_id = ?
         )
         GROUP BY b.account_id"
    )
    .bind(cycle_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut total_paid_by_account = std::collections::HashMap::new();
    for row in payment_rows {
        total_paid_by_account.insert(row.get::<i64, _>("account_id"), row.get::<f64, _>("total_paid"));
    }

    let mut current_account: Option<i64> = None;
    let mut remaining_credit = 0.0;
    let mut results = Vec::new();

    for row in bill_rows {
        let account_id: i64 = row.get("account_id");
        if current_account != Some(account_id) {
            current_account = Some(account_id);
            remaining_credit = *total_paid_by_account.get(&account_id).unwrap_or(&0.0);
        }

        let total_for_month: f64 = row.get("total_for_month");
        let effective_open_balance = if remaining_credit >= total_for_month {
            remaining_credit -= total_for_month;
            0.0
        } else {
            let open = total_for_month - remaining_credit;
            remaining_credit = 0.0;
            open
        };

        let bill_cycle_id: i64 = row.get("billing_cycle_id");
        if bill_cycle_id != cycle_id || effective_open_balance <= 0.0 {
            continue;
        }

        results.push(UnpaidAccountRow {
            bill_id: row.get("bill_id"),
            unit_number: row.get("unit_number"),
            building_code: row.get("building_code"),
            resident_name: row.get("resident_name"),
            account_number: row.get("account_number"),
            total_amount_due: row.get("total_amount_due"),
            outstanding_balance: effective_open_balance,
            due_date: row.get("due_date"),
        });
    }

    results.sort_by(|left, right| {
        right
            .outstanding_balance
            .partial_cmp(&left.outstanding_balance)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.building_code.cmp(&right.building_code))
            .then_with(|| left.unit_number.cmp(&right.unit_number))
    });

    Ok(results)
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
