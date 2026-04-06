use anyhow::Result;
use sqlx::SqlitePool;

pub struct AppState {
    pub db: tokio::sync::Mutex<SqlitePool>,
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    sqlx::query("PRAGMA journal_mode = WAL").execute(pool).await?;
    sqlx::query("PRAGMA foreign_keys = ON").execute(pool).await?;
    sqlx::query("PRAGMA busy_timeout = 5000").execute(pool).await?;

    let users_table_exists: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'"
    )
    .fetch_optional(pool)
    .await?;

    if users_table_exists.is_none() {
        sqlx::raw_sql(include_str!("../db/schema.sql"))
            .execute(pool)
            .await?;
    }

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS unit_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            unit_id INTEGER NOT NULL REFERENCES units(id),
            document_type TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            notes TEXT,
            uploaded_by INTEGER REFERENCES users(id),
            uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_unit_documents_unit ON unit_documents(unit_id)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS service_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            unit_id INTEGER NOT NULL REFERENCES units(id),
            account_id INTEGER REFERENCES accounts(id),
            action_type TEXT NOT NULL CHECK(action_type IN ('disconnection','reconnection')),
            action_date TEXT NOT NULL,
            effective_date TEXT,
            outstanding_balance REAL NOT NULL DEFAULT 0,
            unpaid_periods INTEGER NOT NULL DEFAULT 0,
            reason TEXT NOT NULL,
            notes TEXT,
            recorded_by INTEGER REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS service_action_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_action_id INTEGER NOT NULL REFERENCES service_actions(id),
            document_type TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            notes TEXT,
            uploaded_by INTEGER REFERENCES users(id),
            uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_service_actions_unit ON service_actions(unit_id)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_service_actions_account ON service_actions(account_id)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_service_action_documents_action ON service_action_documents(service_action_id)",
    )
    .execute(pool)
    .await?;

    let payment_columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('payments')")
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    if !payment_columns.iter().any(|column| column == "receipt_group_number") {
        sqlx::query("ALTER TABLE payments ADD COLUMN receipt_group_number TEXT")
            .execute(pool)
            .await?;

        sqlx::query(
            "UPDATE payments
             SET receipt_group_number = receipt_number
             WHERE receipt_group_number IS NULL OR receipt_group_number = ''",
        )
        .execute(pool)
        .await?;
    }

    if !payment_columns.iter().any(|column| column == "account_balance_after") {
        sqlx::query(
            "ALTER TABLE payments
             ADD COLUMN account_balance_after REAL NOT NULL DEFAULT 0",
        )
        .execute(pool)
        .await?;

        sqlx::query(
            "UPDATE payments
             SET account_balance_after = remaining_balance
             WHERE account_balance_after = 0",
        )
        .execute(pool)
        .await?;
    }

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_payments_receipt_group ON payments(receipt_group_number)",
    )
    .execute(pool)
    .await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM system_settings")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    if count == 0 {
        sqlx::raw_sql(include_str!("../db/seed.sql"))
            .execute(pool)
            .await?;
    }

    sqlx::query(
        "INSERT INTO system_settings (key, value, description)
         VALUES ('disconnection_trigger_unpaid_bills', '2', 'Unpaid billing periods allowed before actual disconnection eligibility')
         ON CONFLICT(key) DO NOTHING",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "UPDATE bills
         SET due_date = (
            SELECT date(bc.period_end, 'start of month', '+1 month', '-1 day')
            FROM billing_cycles bc
            WHERE bc.id = bills.billing_cycle_id
         )
         WHERE due_date IS NULL
            OR due_date = (
                SELECT bc.period_end
                FROM billing_cycles bc
                WHERE bc.id = bills.billing_cycle_id
            )",
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_setting(pool: &SqlitePool, key: &str) -> Result<String> {
    let val: String = sqlx::query_scalar("SELECT value FROM system_settings WHERE key = ?")
        .bind(key)
        .fetch_one(pool)
        .await?;
    Ok(val)
}

pub async fn set_setting(
    pool: &SqlitePool,
    key: &str,
    value: &str,
    user_id: Option<i64>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO system_settings (key, value, updated_by, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at"
    )
    .bind(key)
    .bind(value)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn audit_log(
    pool: &SqlitePool,
    user_id: i64,
    action: &str,
    module: &str,
    record_id: Option<i64>,
    details: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, module, record_id, details, logged_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))"
    )
    .bind(user_id)
    .bind(action)
    .bind(module)
    .bind(record_id)
    .bind(details)
    .execute(pool)
    .await?;
    Ok(())
}
