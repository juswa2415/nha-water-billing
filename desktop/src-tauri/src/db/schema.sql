-- ================================================================
-- NHA CAMARIN WATER BILLING — SQLITE SCHEMA
-- ================================================================
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Users and Roles
CREATE TABLE users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name   TEXT NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('admin','billing_staff','cashier','field_staff')),
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT
);

-- Buildings (33 in Camarin Residences)
CREATE TABLE buildings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,           -- e.g. "Building 22"
    code            TEXT NOT NULL UNIQUE,    -- e.g. "BLDG-22"
    total_floors    INTEGER NOT NULL DEFAULT 5,
    sub_meter_number TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE floors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id),
    floor_number INTEGER NOT NULL,
    UNIQUE(building_id, floor_number)
);

-- Units (~1,980 total, ~12 per floor)
CREATE TABLE units (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id        INTEGER NOT NULL REFERENCES floors(id),
    unit_number     TEXT NOT NULL,           -- e.g. "407"
    meter_number    TEXT UNIQUE,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','vacant','inactive','disconnected')),
    activated_at    TEXT,
    deactivated_at  TEXT,
    notes           TEXT,
    UNIQUE(floor_id, unit_number)
);

-- Resident Accounts
CREATE TABLE accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id         INTEGER NOT NULL UNIQUE REFERENCES units(id),
    account_number  TEXT NOT NULL UNIQUE,
    resident_name   TEXT NOT NULL,           -- e.g. "YLAGAN, LUZVIMINDA JAVIER"
    contact_number  TEXT,
    outstanding_balance REAL NOT NULL DEFAULT 0.0,
    registered_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Building Sub-meter Readings (per billing cycle)
CREATE TABLE bldg_sub_readings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id     INTEGER NOT NULL REFERENCES buildings(id),
    billing_cycle_id INTEGER NOT NULL REFERENCES billing_cycles(id),
    previous_reading REAL NOT NULL DEFAULT 0,
    current_reading  REAL NOT NULL DEFAULT 0,
    total_consumption REAL GENERATED ALWAYS AS (current_reading - previous_reading) STORED,
    UNIQUE(building_id, billing_cycle_id)
);

-- Billing Cycles
CREATE TABLE billing_cycles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start    TEXT NOT NULL,           -- e.g. "2025-12-11"
    period_end      TEXT NOT NULL,           -- e.g. "2026-02-11"
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','reading_phase','review_phase','billing','finalized','locked')),
    rate_per_cubicm REAL NOT NULL DEFAULT 28.38,
    -- Community-level Maynilad readings (for common system loss)
    maynilad_prev   REAL,
    maynilad_curr   REAL,
    total_active_units_camres INTEGER,       -- active units across all 10 bldgs
    created_by      INTEGER REFERENCES users(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    finalized_at    TEXT
);

-- Individual Meter Readings
CREATE TABLE meter_readings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id         INTEGER NOT NULL REFERENCES units(id),
    billing_cycle_id INTEGER NOT NULL REFERENCES billing_cycles(id),
    submitted_by    INTEGER REFERENCES users(id),
    previous_reading REAL NOT NULL DEFAULT 0,
    current_reading  REAL,
    consumption      REAL GENERATED ALWAYS AS
                     (CASE WHEN current_reading IS NOT NULL
                      THEN current_reading - previous_reading ELSE NULL END) STORED,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','submitted','flagged','approved','skipped')),
    flag_reason     TEXT,
    notes           TEXT,
    photo_path      TEXT,
    read_at         TEXT,
    approved_by     INTEGER REFERENCES users(id),
    approved_at     TEXT,
    source          TEXT DEFAULT 'mobile' CHECK(source IN ('mobile','manual','imported')),
    UNIQUE(unit_id, billing_cycle_id)
);

-- Bills
CREATE TABLE bills (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id),
    billing_cycle_id INTEGER NOT NULL REFERENCES billing_cycles(id),
    -- Charges (from actual NHA bill format)
    consumption_cubicm  REAL NOT NULL DEFAULT 0,
    water_charge        REAL NOT NULL DEFAULT 0,   -- consumption × rate
    sys_loss_charge     REAL NOT NULL DEFAULT 0,   -- bldg system loss ÷ active units × rate
    common_sys_loss     REAL NOT NULL DEFAULT 0,   -- CamRes common loss ÷ total units × rate
    reconnection_fee    REAL NOT NULL DEFAULT 0,
    penalty             REAL NOT NULL DEFAULT 0,
    previous_balance    REAL NOT NULL DEFAULT 0,
    -- Computed totals
    total_for_month     REAL NOT NULL DEFAULT 0,   -- sum of charges (excl prev balance)
    total_amount_due    REAL NOT NULL DEFAULT 0,   -- total_for_month + previous_balance
    -- Status
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','finalized','locked','adjusted')),
    due_date        TEXT,
    generated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    generated_by    INTEGER REFERENCES users(id),
    UNIQUE(account_id, billing_cycle_id)
);

-- Payments and Receipts
CREATE TABLE payments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id         INTEGER NOT NULL REFERENCES bills(id),
    received_by     INTEGER NOT NULL REFERENCES users(id),
    amount_paid     REAL NOT NULL,
    remaining_balance REAL NOT NULL DEFAULT 0,
    receipt_number  TEXT NOT NULL UNIQUE,    -- e.g. "0002164"
    payment_date    TEXT NOT NULL DEFAULT (date('now')),
    period_start    TEXT,
    period_end      TEXT,
    payment_method  TEXT DEFAULT 'cash',
    is_void         INTEGER NOT NULL DEFAULT 0,
    void_reason     TEXT,
    void_approved_by INTEGER REFERENCES users(id),
    void_at         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit Logs
CREATE TABLE audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL,
    module      TEXT NOT NULL,
    record_id   INTEGER,
    details     TEXT,
    ip_address  TEXT,
    logged_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- System Settings (key-value)
CREATE TABLE system_settings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT NOT NULL UNIQUE,
    value       TEXT NOT NULL,
    description TEXT,
    updated_by  INTEGER REFERENCES users(id),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX idx_units_status ON units(status);
CREATE INDEX idx_units_floor ON units(floor_id);
CREATE INDEX idx_meter_readings_cycle ON meter_readings(billing_cycle_id);
CREATE INDEX idx_meter_readings_unit ON meter_readings(unit_id);
CREATE INDEX idx_meter_readings_status ON meter_readings(status);
CREATE INDEX idx_bills_cycle ON bills(billing_cycle_id);
CREATE INDEX idx_bills_account ON bills(account_id);
CREATE INDEX idx_bills_status ON bills(status);
CREATE INDEX idx_payments_bill ON payments(bill_id);
CREATE INDEX idx_payments_receipt ON payments(receipt_number);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_module ON audit_logs(module);

-- ================================================================
-- DEFAULT DATA
-- ================================================================
INSERT INTO system_settings (key, value, description) VALUES
  ('rate_per_cubicm', '28.38', 'Current rate per cubic meter in PhP'),
  ('organization_name', 'National Housing Authority', 'Organization name for bills'),
  ('district_office', 'Caloocan District Office', 'District office name'),
  ('community_name', 'Camarin Residences 3', 'Community/project name'),
  ('receipt_prefix', '', 'Prefix for receipt numbers'),
  ('receipt_next_number', '1', 'Next receipt sequential number'),
  ('disconnection_notice_days', '7', 'Days after due date before disconnection notice'),
  ('penalty_rate', '0', 'Penalty rate for late payment');