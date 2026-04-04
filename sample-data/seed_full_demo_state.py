from __future__ import annotations

import csv
import hashlib
import json
import os
import random
import sqlite3
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
APP_DB = Path(os.environ.get("APPDATA", "")) / "ph.gov.nha.camarin.waterbilling" / "nha_billing.db"
SCHEMA_PATH = PROJECT_ROOT / "desktop" / "src-tauri" / "src" / "db" / "schema.sql"
UNITS_CSV_PATH = ROOT / "desktop-units-13-22.csv"
BUILDINGS_SQL_PATH = ROOT / "desktop-buildings-13-22.sql"
MOBILE_READING_LIST_PATH = ROOT / "mobile-reading-list-current.json"
SUMMARY_PATH = ROOT / "demo-state-summary.txt"

SEED = 20260328
RATE_PER_CUBIC_METER = 28.38


@dataclass
class ActiveUnit:
    unit_id: int
    account_id: int
    building_id: int
    building_code: str
    floor_number: int
    unit_number: str
    resident_name: str
    meter_number: str | None


def parse_db_path() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1]).expanduser().resolve()
    return APP_DB


def initialize_if_missing(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    if cur.fetchone():
        return

    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema)
    conn.commit()


def ensure_admin_user(conn: sqlite3.Connection) -> int:
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    row = cur.fetchone()
    if row:
        return int(row[0])

    cur.execute(
        """
        INSERT INTO users (username, password_hash, full_name, role, active, created_at)
        VALUES (?, ?, ?, 'admin', 1, datetime('now'))
        """,
        ("admin", "seeded-demo-hash", "System Administrator"),
    )
    conn.commit()
    return int(cur.lastrowid)


def apply_buildings_seed(conn: sqlite3.Connection) -> None:
    sql = BUILDINGS_SQL_PATH.read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.commit()


def load_floor_map(conn: sqlite3.Connection) -> dict[tuple[str, int], int]:
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT b.code, f.floor_number, f.id
        FROM floors f
        JOIN buildings b ON b.id = f.building_id
        """
    ).fetchall()
    return {(row[0], int(row[1])): int(row[2]) for row in rows}


def import_large_units(conn: sqlite3.Connection) -> dict[str, int]:
    floor_map = load_floor_map(conn)
    cur = conn.cursor()
    inserted_units = 0
    updated_units = 0
    inserted_accounts = 0
    updated_accounts = 0
    deleted_accounts = 0

    with UNITS_CSV_PATH.open(newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        for row in reader:
            building_code = row["building_code"].strip()
            floor_number = int(row["floor_number"])
            unit_number = row["unit_number"].strip()
            meter_number = row["meter_number"].strip() or None
            status = row["status"].strip()
            resident_name = row["resident_name"].strip()
            contact = row["contact"].strip() or None
            account_number = row["account_number"].strip() or None
            floor_id = floor_map[(building_code, floor_number)]

            existing = cur.execute(
                "SELECT id, activated_at FROM units WHERE floor_id = ? AND unit_number = ?",
                (floor_id, unit_number),
            ).fetchone()

            if existing:
                unit_id = int(existing[0])
                activated_at = existing[1]
                cur.execute(
                    """
                    UPDATE units
                    SET meter_number = ?,
                        status = ?,
                        activated_at = CASE
                            WHEN ? = 'active' THEN COALESCE(activated_at, datetime('now'))
                            ELSE activated_at
                        END,
                        deactivated_at = CASE
                            WHEN ? != 'active' THEN datetime('now')
                            ELSE NULL
                        END
                    WHERE id = ?
                    """,
                    (meter_number, status, status, status, unit_id),
                )
                updated_units += 1
            else:
                cur.execute(
                    """
                    INSERT INTO units (floor_id, unit_number, meter_number, status, activated_at)
                    VALUES (?, ?, ?, ?, CASE WHEN ? = 'active' THEN datetime('now') ELSE NULL END)
                    """,
                    (floor_id, unit_number, meter_number, status, status),
                )
                unit_id = int(cur.lastrowid)
                inserted_units += 1

            account = cur.execute(
                "SELECT id FROM accounts WHERE unit_id = ?",
                (unit_id,),
            ).fetchone()

            if resident_name:
                if not account_number:
                    account_number = f"ACC-{building_code[-2:]}-{unit_number}"

                if account:
                    cur.execute(
                        """
                        UPDATE accounts
                        SET account_number = ?,
                            resident_name = ?,
                            contact_number = ?
                        WHERE unit_id = ?
                        """,
                        (account_number, resident_name, contact, unit_id),
                    )
                    updated_accounts += 1
                else:
                    cur.execute(
                        """
                        INSERT INTO accounts (unit_id, account_number, resident_name, contact_number, outstanding_balance, registered_at)
                        VALUES (?, ?, ?, ?, 0, datetime('now'))
                        """,
                        (unit_id, account_number, resident_name, contact),
                    )
                    inserted_accounts += 1
            elif account:
                cur.execute("DELETE FROM accounts WHERE unit_id = ?", (unit_id,))
                deleted_accounts += 1

    conn.commit()
    return {
        "inserted_units": inserted_units,
        "updated_units": updated_units,
        "inserted_accounts": inserted_accounts,
        "updated_accounts": updated_accounts,
        "deleted_accounts": deleted_accounts,
    }


def clear_billing_state(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    for table in ["payments", "bills", "bldg_sub_readings", "meter_readings", "billing_cycles"]:
        cur.execute(f"DELETE FROM {table}")
    cur.execute("UPDATE accounts SET outstanding_balance = 0")
    cur.execute(
        "UPDATE system_settings SET value = '1', updated_at = datetime('now') WHERE key = 'receipt_next_number'"
    )
    conn.commit()


def get_active_units(conn: sqlite3.Connection) -> list[ActiveUnit]:
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT u.id AS unit_id, a.id AS account_id, b.id AS building_id, b.code AS building_code,
               f.floor_number, u.unit_number, a.resident_name, u.meter_number
        FROM units u
        JOIN accounts a ON a.unit_id = u.id
        JOIN floors f ON f.id = u.floor_id
        JOIN buildings b ON b.id = f.building_id
        WHERE u.status = 'active'
        ORDER BY b.code, f.floor_number, u.unit_number
        """
    ).fetchall()
    return [
        ActiveUnit(
            unit_id=int(row[0]),
            account_id=int(row[1]),
            building_id=int(row[2]),
            building_code=str(row[3]),
            floor_number=int(row[4]),
            unit_number=str(row[5]),
            resident_name=str(row[6]),
            meter_number=row[7],
        )
        for row in rows
    ]


def dt_at(day: date, hour: int, minute: int) -> str:
    return datetime.combine(day, time(hour=hour, minute=minute)).strftime("%Y-%m-%d %H:%M:%S")


def d(day: date) -> str:
    return day.isoformat()


def random_consumption(rng: random.Random, building_code: str, floor_number: int) -> float:
    building_bias = (int(building_code[-2:]) % 4) * 0.8
    floor_bias = max(0, 3 - floor_number) * 0.35
    base = rng.uniform(5.5, 18.5) + building_bias + floor_bias
    return round(max(base, 1.5), 2)


def payment_mode(rng: random.Random, cycle_index: int) -> str:
    roll = rng.random()
    thresholds = [
        (0.68, 0.90),  # cycle 1: full / partial / unpaid
        (0.52, 0.77),  # cycle 2
        (0.36, 0.66),  # cycle 3
    ][cycle_index]
    if roll < thresholds[0]:
        return "full"
    if roll < thresholds[1]:
        return "partial"
    return "unpaid"


def cycle_definitions() -> list[dict[str, object]]:
    return [
        {
            "period_start": date(2025, 12, 11),
            "period_end": date(2026, 1, 11),
            "status": "locked",
        },
        {
            "period_start": date(2026, 1, 12),
            "period_end": date(2026, 2, 11),
            "status": "finalized",
        },
        {
            "period_start": date(2026, 2, 12),
            "period_end": date(2026, 3, 11),
            "status": "billing",
        },
        {
            "period_start": date(2026, 3, 12),
            "period_end": date(2026, 4, 11),
            "status": "reading_phase",
        },
    ]


def seed_cycles(conn: sqlite3.Connection, admin_user_id: int, units: list[ActiveUnit]) -> dict[str, object]:
    rng = random.Random(SEED)
    cur = conn.cursor()
    account_balances: dict[int, float] = {unit.account_id: 0.0 for unit in units}
    latest_readings: dict[int, float] = {
        unit.unit_id: round(120 + rng.uniform(0, 220) + (int(unit.building_code[-2:]) * 2), 2)
        for unit in units
    }

    receipt_next = 1
    cycle_ids: list[int] = []
    cycle_status_counts: dict[int, dict[str, int]] = {}

    maynilad_running = 78000.0
    bldg_running: dict[int, float] = defaultdict(lambda: 5200.0)

    for cycle_index, cycle_meta in enumerate(cycle_definitions()):
        period_start: date = cycle_meta["period_start"]  # type: ignore[assignment]
        period_end: date = cycle_meta["period_end"]  # type: ignore[assignment]
        status: str = cycle_meta["status"]  # type: ignore[assignment]

        cur.execute(
            """
            INSERT INTO billing_cycles
                (period_start, period_end, status, rate_per_cubicm, maynilad_prev, maynilad_curr,
                 total_active_units_camres, created_by, created_at, finalized_at)
            VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
            """,
            (
                d(period_start),
                d(period_end),
                status,
                RATE_PER_CUBIC_METER,
                len(units),
                admin_user_id,
                dt_at(period_start, 8, 30),
                dt_at(period_end if status in {"locked", "finalized"} else period_start, 17, 0)
                if status in {"locked", "finalized"}
                else None,
            ),
        )
        cycle_id = int(cur.lastrowid)
        cycle_ids.append(cycle_id)

        if cycle_index < 3:
            building_consumption: dict[int, float] = defaultdict(float)
            building_active: dict[int, int] = defaultdict(int)
            historical_rows: list[dict[str, object]] = []

            for unit in units:
                previous = latest_readings[unit.unit_id]
                consumption = random_consumption(rng, unit.building_code, unit.floor_number)
                current = round(previous + consumption, 2)
                read_at = dt_at(period_end - timedelta(days=rng.randint(1, 5)), 10 + rng.randint(0, 6), rng.randint(0, 59))

                cur.execute(
                    """
                    INSERT INTO meter_readings
                        (unit_id, billing_cycle_id, submitted_by, previous_reading, current_reading,
                         status, notes, read_at, source, approved_by, approved_at)
                    VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, 'imported', ?, ?)
                    """,
                    (
                        unit.unit_id,
                        cycle_id,
                        admin_user_id,
                        previous,
                        current,
                        "Seeded historical reading",
                        read_at,
                        admin_user_id,
                        read_at,
                    ),
                )

                building_consumption[unit.building_id] += consumption
                building_active[unit.building_id] += 1
                latest_readings[unit.unit_id] = current
                historical_rows.append(
                    {
                        "unit": unit,
                        "previous": previous,
                        "current": current,
                        "consumption": consumption,
                    }
                )

            sum_all_sub_meters = 0.0
            bldg_loss_per_unit_php: dict[int, float] = {}
            for building_id, total_consumption in sorted(building_consumption.items()):
                previous_sub = bldg_running[building_id]
                system_loss = round(rng.uniform(10.0, 28.0), 2)
                current_sub = round(previous_sub + total_consumption + system_loss, 2)
                bldg_running[building_id] = current_sub
                sum_all_sub_meters += current_sub - previous_sub
                active_in_bldg = max(building_active[building_id], 1)
                bldg_loss_per_unit_php[building_id] = round((system_loss * RATE_PER_CUBIC_METER) / active_in_bldg, 2)
                cur.execute(
                    """
                    INSERT INTO bldg_sub_readings (building_id, billing_cycle_id, previous_reading, current_reading)
                    VALUES (?, ?, ?, ?)
                    """,
                    (building_id, cycle_id, previous_sub, current_sub),
                )

            common_loss = round(rng.uniform(55.0, 98.0), 2)
            maynilad_prev = maynilad_running
            maynilad_curr = round(maynilad_prev + sum_all_sub_meters + common_loss, 2)
            maynilad_running = maynilad_curr
            common_loss_per_unit = round((common_loss * RATE_PER_CUBIC_METER) / max(len(units), 1), 2)

            cur.execute(
                """
                UPDATE billing_cycles
                SET maynilad_prev = ?, maynilad_curr = ?, total_active_units_camres = ?
                WHERE id = ?
                """,
                (maynilad_prev, maynilad_curr, len(units), cycle_id),
            )

            due_date = period_end + timedelta(days=11)

            for row in historical_rows:
                unit: ActiveUnit = row["unit"]  # type: ignore[assignment]
                consumption = float(row["consumption"])
                previous_balance = round(account_balances[unit.account_id], 2)
                water_charge = round(consumption * RATE_PER_CUBIC_METER, 2)
                sys_loss_charge = bldg_loss_per_unit_php[unit.building_id]
                common_sys_loss = common_loss_per_unit
                total_for_month = round(water_charge + sys_loss_charge + common_sys_loss, 2)
                total_amount_due = round(total_for_month + previous_balance, 2)

                cur.execute(
                    """
                    INSERT INTO bills
                        (account_id, billing_cycle_id, consumption_cubicm, water_charge, sys_loss_charge,
                         common_sys_loss, previous_balance, total_for_month, total_amount_due,
                         status, due_date, generated_at, generated_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
                    """,
                    (
                        unit.account_id,
                        cycle_id,
                        consumption,
                        water_charge,
                        sys_loss_charge,
                        common_sys_loss,
                        previous_balance,
                        total_for_month,
                        total_amount_due,
                        d(due_date),
                        dt_at(period_end, 14, 0),
                        admin_user_id,
                    ),
                )
                bill_id = int(cur.lastrowid)

                mode = payment_mode(rng, cycle_index)
                amount_paid = 0.0
                if mode == "full":
                    amount_paid = total_amount_due
                elif mode == "partial":
                    amount_paid = round(total_amount_due * rng.uniform(0.35, 0.78), 2)

                remaining = round(max(total_amount_due - amount_paid, 0.0), 2)
                account_balances[unit.account_id] = remaining

                if amount_paid > 0:
                    payment_date = due_date - timedelta(days=rng.randint(0, 4)) if mode == "full" else due_date + timedelta(days=rng.randint(1, 9))
                    receipt_number = f"{receipt_next:07d}"
                    receipt_next += 1
                    cur.execute(
                        """
                        INSERT INTO payments
                            (bill_id, received_by, amount_paid, remaining_balance, receipt_number,
                             payment_date, period_start, period_end, payment_method, is_void, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cash', 0, ?)
                        """,
                        (
                            bill_id,
                            admin_user_id,
                            amount_paid,
                            remaining,
                            receipt_number,
                            d(payment_date),
                            d(period_start),
                            d(period_end),
                            dt_at(payment_date, 11, 0),
                        ),
                    )

                if remaining <= 0:
                    cur.execute("UPDATE bills SET status = 'finalized' WHERE id = ?", (bill_id,))

            cycle_status_counts[cycle_id] = {"approved": len(units), "submitted": 0, "flagged": 0, "pending": 0}

        else:
            counts = {"approved": 0, "submitted": 0, "flagged": 0, "pending": 0}
            approved_quota = max(20, int(len(units) * 0.10))
            submitted_quota = max(60, int(len(units) * 0.28))
            flagged_quota = max(18, int(len(units) * 0.07))

            for index, unit in enumerate(units):
                previous = latest_readings[unit.unit_id]

                if index < approved_quota:
                    reading_status = "approved"
                elif index < approved_quota + submitted_quota:
                    reading_status = "submitted"
                elif index < approved_quota + submitted_quota + flagged_quota:
                    reading_status = "flagged"
                else:
                    reading_status = "pending"

                counts[reading_status] += 1

                if reading_status == "pending":
                    cur.execute(
                        """
                        INSERT INTO meter_readings
                            (unit_id, billing_cycle_id, previous_reading, status, source)
                        VALUES (?, ?, ?, 'pending', 'mobile')
                        """,
                        (unit.unit_id, cycle_id, previous),
                    )
                    continue

                if reading_status == "flagged" and rng.random() < 0.5:
                    current = round(previous - rng.uniform(0.5, 4.5), 2)
                    flag_reason = "CURRENT_BELOW_PREVIOUS"
                elif reading_status == "flagged":
                    current = round(previous + random_consumption(rng, unit.building_code, unit.floor_number) * rng.uniform(4.2, 5.7), 2)
                    flag_reason = "ABNORMAL_SPIKE"
                else:
                    current = round(previous + random_consumption(rng, unit.building_code, unit.floor_number), 2)
                    flag_reason = None

                read_day = period_start + timedelta(days=rng.randint(0, 11))
                read_at = dt_at(read_day, 9 + rng.randint(0, 6), rng.randint(0, 59))
                note = "Seeded current-cycle reading"

                cur.execute(
                    """
                    INSERT INTO meter_readings
                        (unit_id, billing_cycle_id, submitted_by, previous_reading, current_reading,
                         status, flag_reason, notes, read_at, source, approved_by, approved_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mobile', ?, ?)
                    """,
                    (
                        unit.unit_id,
                        cycle_id,
                        admin_user_id,
                        previous,
                        current,
                        reading_status,
                        flag_reason,
                        note,
                        read_at,
                        admin_user_id if reading_status == "approved" else None,
                        read_at if reading_status == "approved" else None,
                    ),
                )

            cycle_status_counts[cycle_id] = counts

    cur.execute(
        "UPDATE system_settings SET value = ?, updated_at = datetime('now') WHERE key = 'receipt_next_number'",
        (str(receipt_next),),
    )
    for account_id, balance in account_balances.items():
        cur.execute(
            "UPDATE accounts SET outstanding_balance = ? WHERE id = ?",
            (round(balance, 2), account_id),
        )
    conn.commit()

    return {
        "cycle_ids": cycle_ids,
        "cycle_status_counts": cycle_status_counts,
        "total_active_units": len(units),
    }


def export_mobile_reading_list(conn: sqlite3.Connection, cycle_id: int) -> int:
    cur = conn.cursor()
    cycle = cur.execute(
        "SELECT period_start, period_end FROM billing_cycles WHERE id = ?",
        (cycle_id,),
    ).fetchone()
    rows = cur.execute(
        """
        SELECT mr.unit_id, u.unit_number, b.code AS building_code, f.floor_number,
               u.meter_number, a.resident_name, mr.previous_reading, mr.status AS reading_status
        FROM meter_readings mr
        JOIN units u ON u.id = mr.unit_id
        JOIN floors f ON f.id = u.floor_id
        JOIN buildings b ON b.id = f.building_id
        LEFT JOIN accounts a ON a.unit_id = u.id
        WHERE mr.billing_cycle_id = ?
        ORDER BY b.code, f.floor_number, u.unit_number
        """,
        (cycle_id,),
    ).fetchall()

    payload = {
        "billing_cycle_id": cycle_id,
        "period_start": cycle[0],
        "period_end": cycle[1],
        "exported_at": datetime.now().isoformat(),
        "units": [
            {
                "unit_id": int(row[0]),
                "unit_number": row[1],
                "building_code": row[2],
                "floor_number": int(row[3]),
                "meter_number": row[4],
                "resident_name": row[5],
                "previous_reading": float(row[6]),
                "reading_status": row[7],
            }
            for row in rows
        ],
    }

    MOBILE_READING_LIST_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return len(payload["units"])


def write_summary(import_stats: dict[str, int], cycle_stats: dict[str, object], mobile_count: int, db_path: Path) -> None:
    lines = [
        f"Seed: {SEED}",
        f"Database: {db_path}",
        "",
        "Unit import/update:",
        f"  inserted_units: {import_stats['inserted_units']}",
        f"  updated_units: {import_stats['updated_units']}",
        f"  inserted_accounts: {import_stats['inserted_accounts']}",
        f"  updated_accounts: {import_stats['updated_accounts']}",
        f"  deleted_accounts: {import_stats['deleted_accounts']}",
        "",
        f"Total active units seeded into cycles: {cycle_stats['total_active_units']}",
        f"Billing cycle ids: {', '.join(str(cid) for cid in cycle_stats['cycle_ids'])}",
        "",
        "Per-cycle reading status counts:",
    ]

    for cycle_id in cycle_stats["cycle_ids"]:
        counts = cycle_stats["cycle_status_counts"][cycle_id]
        lines.append(
            f"  cycle {cycle_id}: approved={counts['approved']}, submitted={counts['submitted']}, flagged={counts['flagged']}, pending={counts['pending']}"
        )

    lines.extend(
        [
            "",
            f"Mobile reading list file: {MOBILE_READING_LIST_PATH.name}",
            f"Units in mobile reading list: {mobile_count}",
            "",
            "Notes:",
            "  - Historical cycles were seeded with approved readings, bills, and mixed payment states.",
            "  - The latest cycle is left in reading_phase so review/export screens have live data.",
            "  - Account outstanding balances now reflect the latest seeded unpaid amounts.",
        ]
    )

    SUMMARY_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    db_path = parse_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    try:
        initialize_if_missing(conn)
        admin_user_id = ensure_admin_user(conn)
        apply_buildings_seed(conn)
        import_stats = import_large_units(conn)
        clear_billing_state(conn)
        units = get_active_units(conn)
        cycle_stats = seed_cycles(conn, admin_user_id, units)
        mobile_count = export_mobile_reading_list(conn, cycle_stats["cycle_ids"][-1])
        write_summary(import_stats, cycle_stats, mobile_count, db_path)
    finally:
        conn.close()

    print(f"Seeded full demo state into {db_path}")
    print(f"Wrote {MOBILE_READING_LIST_PATH.name}")
    print(f"Wrote {SUMMARY_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
