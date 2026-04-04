from pathlib import Path
import os
import sqlite3
import sys


APP_DIR = Path(os.environ["APPDATA"]) / "ph.gov.nha.camarin.waterbilling"
DB_PATH = APP_DIR / "nha_billing.db"
SQL_PATH = Path(__file__).with_name("desktop-buildings-13-22.sql")


def main() -> int:
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        print("Run the desktop app once first so Tauri can create the database.")
        return 1

    sql = SQL_PATH.read_text(encoding="utf-8")

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(sql)
        conn.commit()

        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM buildings WHERE code BETWEEN 'BLDG-13' AND 'BLDG-22'")
        building_count = cur.fetchone()[0]
        cur.execute(
            """
            SELECT COUNT(*)
            FROM floors f
            JOIN buildings b ON b.id = f.building_id
            WHERE b.code BETWEEN 'BLDG-13' AND 'BLDG-22'
            """
        )
        floor_count = cur.fetchone()[0]
    finally:
        conn.close()

    print(f"Seed complete: {building_count} building(s), {floor_count} floor record(s).")
    print("You can now reopen the desktop app and import desktop-units-13-22.csv.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
