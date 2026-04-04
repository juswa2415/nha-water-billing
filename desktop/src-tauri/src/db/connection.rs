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

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM system_settings")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    if count == 0 {
        sqlx::raw_sql(include_str!("../db/seed.sql"))
            .execute(pool)
            .await?;
    }

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
