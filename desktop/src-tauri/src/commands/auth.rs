// src-tauri/src/commands/auth.rs

use crate::db::connection::{AppState, audit_log};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::{rand_core::OsRng, SaltString};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use sqlx::SqlitePool;
use tauri::State;
use std::sync::Mutex as StdMutex;

// In-memory session — holds the currently logged-in user for the app lifetime
static CURRENT_USER: StdMutex<Option<SessionUser>> = StdMutex::new(None);

pub async fn ensure_default_admin(pool: &SqlitePool) -> Result<(), String> {
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

    if user_count > 0 {
        return Ok(());
    }

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password("admin123".as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    sqlx::query(
        "INSERT INTO users (username, password_hash, full_name, role, active)
         VALUES ('admin', ?, 'System Administrator', 'admin', 1)"
    )
    .bind(hash)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionUser {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResult {
    pub success: bool,
    pub user: Option<SessionUser>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn login(
    payload: LoginRequest,
    state: State<'_, AppState>,
) -> Result<LoginResult, String> {
    let pool = state.db.lock().await;

    let row = sqlx::query(
        "SELECT id, username, password_hash, full_name, role, active
         FROM users WHERE username = ?"
    )
    .bind(&payload.username)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let row = match row {
        Some(r) => r,
        None => return Ok(LoginResult {
            success: false,
            user: None,
            error: Some("Invalid username or password.".into()),
        }),
    };

    let active: i64 = row.get("active");
    if active == 0 {
        return Ok(LoginResult {
            success: false,
            user: None,
            error: Some("Account is deactivated. Contact your administrator.".into()),
        });
    }

    let hash: String = row.get("password_hash");
    let parsed_hash = PasswordHash::new(&hash).map_err(|e| e.to_string())?;
    let valid = Argon2::default()
        .verify_password(payload.password.as_bytes(), &parsed_hash)
        .is_ok();

    if !valid {
        return Ok(LoginResult {
            success: false,
            user: None,
            error: Some("Invalid username or password.".into()),
        });
    }

    let user = SessionUser {
        id: row.get("id"),
        username: row.get("username"),
        full_name: row.get("full_name"),
        role: row.get("role"),
    };

    // Update last_login
    sqlx::query("UPDATE users SET last_login = datetime('now') WHERE id = ?")
        .bind(user.id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    audit_log(&pool, user.id, "LOGIN", "auth", None, "User logged in")
        .await
        .ok();

    *CURRENT_USER.lock().unwrap() = Some(user.clone());

    Ok(LoginResult { success: true, user: Some(user), error: None })
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    let current_user = CURRENT_USER.lock().unwrap().clone();
    if let Some(user) = current_user {
        let pool = state.db.lock().await;
        audit_log(&pool, user.id, "LOGOUT", "auth", None, "User logged out")
            .await
            .ok();
    }
    *CURRENT_USER.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn get_current_user() -> Result<Option<SessionUser>, String> {
    Ok(CURRENT_USER.lock().unwrap().clone())
}

/// Require a logged-in user with one of the allowed roles.
/// Call this at the start of every sensitive command.
pub fn require_role(allowed: &[&str]) -> Result<SessionUser, String> {
    let user = CURRENT_USER
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Not authenticated.".to_string())?;
    if allowed.contains(&user.role.as_str()) {
        Ok(user)
    } else {
        Err(format!(
            "Access denied. Required roles: {}. Your role: {}.",
            allowed.join(", "),
            user.role
        ))
    }
}

// ── User Management (admin only) ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub full_name: String,
    pub role: String,
}

#[tauri::command]
pub async fn create_user(
    payload: CreateUserRequest,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(payload.password.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    let id = sqlx::query(
        "INSERT INTO users (username, password_hash, full_name, role)
         VALUES (?, ?, ?, ?)"
    )
    .bind(&payload.username)
    .bind(&hash)
    .bind(&payload.full_name)
    .bind(&payload.role)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    audit_log(&pool, caller.id, "CREATE_USER", "users", Some(id),
        &format!("Created user: {}", payload.username))
        .await.ok();

    Ok(id)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub id: i64,
    pub full_name: Option<String>,
    pub role: Option<String>,
    pub active: Option<bool>,
    pub new_password: Option<String>,
}

#[tauri::command]
pub async fn update_user(
    payload: UpdateUserRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let caller = require_role(&["admin"])?;
    let pool = state.db.lock().await;

    if let Some(name) = &payload.full_name {
        sqlx::query("UPDATE users SET full_name = ? WHERE id = ?")
            .bind(name).bind(payload.id)
            .execute(&*pool).await.map_err(|e| e.to_string())?;
    }
    if let Some(role) = &payload.role {
        sqlx::query("UPDATE users SET role = ? WHERE id = ?")
            .bind(role).bind(payload.id)
            .execute(&*pool).await.map_err(|e| e.to_string())?;
    }
    if let Some(active) = payload.active {
        sqlx::query("UPDATE users SET active = ? WHERE id = ?")
            .bind(active as i64).bind(payload.id)
            .execute(&*pool).await.map_err(|e| e.to_string())?;
    }
    if let Some(pw) = &payload.new_password {
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(pw.as_bytes(), &salt)
            .map_err(|e| e.to_string())?
            .to_string();
        sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(&hash).bind(payload.id)
            .execute(&*pool).await.map_err(|e| e.to_string())?;
    }

    audit_log(&pool, caller.id, "UPDATE_USER", "users", Some(payload.id), "User updated")
        .await.ok();

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct UserRow {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role: String,
    pub active: bool,
    pub last_login: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub async fn list_users(state: State<'_, AppState>) -> Result<Vec<UserRow>, String> {
    require_role(&["admin"])?;
    let pool = state.db.lock().await;

    let rows = sqlx::query(
        "SELECT id, username, full_name, role, active, last_login, created_at
         FROM users ORDER BY full_name"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| UserRow {
        id: r.get("id"),
        username: r.get("username"),
        full_name: r.get("full_name"),
        role: r.get("role"),
        active: r.get::<i64, _>("active") == 1,
        last_login: r.get("last_login"),
        created_at: r.get("created_at"),
    }).collect())
}
