from __future__ import annotations

import csv
import random
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "desktop-units-13-22.csv"
SQL_PATH = ROOT / "desktop-buildings-13-22.sql"
SUMMARY_PATH = ROOT / "desktop-units-13-22-summary.txt"

SEED = 20260328
BUILDING_NUMBERS = list(range(13, 23))
FLOORS_PER_BUILDING = 5
UNITS_PER_FLOOR = 12
MIN_OCCUPIED = 45
MAX_OCCUPIED = 55

SURNAMES = [
    "SANTOS", "REYES", "CRUZ", "BAUTISTA", "GARCIA", "DELA CRUZ", "MENDOZA",
    "TORRES", "RAMOS", "FLORES", "GONZALES", "AQUINO", "RIVERA", "MERCADO",
    "LOPEZ", "HERNANDEZ", "VELASCO", "CASTRO", "VILLANUEVA", "PASCUAL",
    "NAVARRO", "DOMINGO", "ESPIRITU", "SALVADOR", "AGUILAR", "MALABANAN",
    "DE GUZMAN", "MANALO", "OLIVARES", "DEL ROSARIO", "FERNANDEZ", "LIM",
    "MARQUEZ", "ALVAREZ", "CORTEZ", "TOLENTINO", "SORIANO", "MARTINEZ",
    "ESTRADA", "MIRANDA", "FAJARDO", "VALDEZ", "CABRERA", "ILAGAN", "MACAPAGAL",
    "LUCERO", "PADILLA", "SAMSON", "TAN", "YAP", "TRINIDAD", "NICOLAS",
]

FIRST_NAMES = [
    "MARIA", "JOSE", "JUAN", "ANA", "CARLO", "ANGEL", "PAOLO", "JESSA",
    "RICHARD", "ELIZABETH", "MICHAEL", "CRISTINA", "LORENA", "MARK", "JOHN",
    "PATRICIA", "CATHERINE", "ARNEL", "SHARON", "JANE", "RINA", "NOEL",
    "GERALD", "NATHANIEL", "BENJAMIN", "PETER", "PAUL", "LIZA", "MARY ANN",
    "RICARDO", "CECILIA", "ANNA", "ANGELICA", "ELAINE", "RONALD", "HENRY",
    "PATRICK", "MELANIE", "FRANCIS", "JOY", "ALAN", "FE", "RODERICK",
    "MARIA LUISA", "JOEL", "MICHELLE", "DANICA", "EDUARDO", "ROSEMARIE",
    "JULIUS", "JASMINE", "CARMINA", "ERIKA", "VICTOR", "LEONARDO",
]

MIDDLE_NAMES = [
    "SANTOS", "CRUZ", "RAMOS", "PEREZ", "MENDOZA", "FLORES", "REYES",
    "TORRES", "BAUTISTA", "GARCIA", "AQUINO", "RIVERA", "LOPEZ", "CASTRO",
    "VELASCO", "DOMINGO", "MERCADO", "PASCUAL", "SALVADOR", "AGUILAR",
    "VILLANUEVA", "NAVARRO", "DELA CRUZ", "TAN", "YAP", "TRINIDAD",
]


def build_unit_numbers() -> list[tuple[int, str]]:
    numbers: list[tuple[int, str]] = []
    for floor in range(1, FLOORS_PER_BUILDING + 1):
        for slot in range(1, UNITS_PER_FLOOR + 1):
            unit_number = f"{floor}{slot:02d}"
            numbers.append((floor, unit_number))
    return numbers


def next_name(rng: random.Random, used: set[str]) -> str:
    while True:
        name = f"{rng.choice(SURNAMES)}, {rng.choice(FIRST_NAMES)} {rng.choice(MIDDLE_NAMES)}"
        if name not in used:
            used.add(name)
            return name


def write_sql() -> None:
    building_values = []
    for building in BUILDING_NUMBERS:
        building_values.append(
            f"  ('Building {building}', 'BLDG-{building:02d}', 5, 'SM-{building:02d}-0001', 'Large demo building seed')"
        )

    sql = "\n".join(
        [
            "BEGIN TRANSACTION;",
            "",
            "INSERT OR IGNORE INTO buildings (name, code, total_floors, sub_meter_number, notes)",
            "VALUES",
            ",\n".join(building_values) + ";",
            "",
            "WITH RECURSIVE floor_seq(n) AS (",
            "  SELECT 1",
            "  UNION ALL",
            "  SELECT n + 1 FROM floor_seq WHERE n < 5",
            ")",
            "INSERT OR IGNORE INTO floors (building_id, floor_number)",
            "SELECT b.id, floor_seq.n",
            "FROM buildings b",
            "JOIN floor_seq",
            "WHERE b.code IN ("
            + ", ".join(f"'BLDG-{building:02d}'" for building in BUILDING_NUMBERS)
            + ");",
            "",
            "COMMIT;",
            "",
        ]
    )

    SQL_PATH.write_text(sql, encoding="utf-8")


def write_csv_and_summary() -> None:
    rng = random.Random(SEED)
    used_names: set[str] = set()
    unit_numbers = build_unit_numbers()
    contact_serial = 172300000
    summary_lines = [
        f"Seed: {SEED}",
        f"Buildings: {BUILDING_NUMBERS[0]}-{BUILDING_NUMBERS[-1]} inclusive",
        f"Floors per building: {FLOORS_PER_BUILDING}",
        f"Units per floor: {UNITS_PER_FLOOR}",
        "",
        "Per-building occupancy:",
    ]

    total_active = 0
    total_vacant = 0

    with CSV_PATH.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(
            [
                "building_code",
                "floor_number",
                "unit_number",
                "meter_number",
                "status",
                "resident_name",
                "contact",
                "account_number",
            ]
        )

        for building in BUILDING_NUMBERS:
            occupied_target = rng.randint(MIN_OCCUPIED, MAX_OCCUPIED)
            occupied_units = set(rng.sample([unit for _, unit in unit_numbers], occupied_target))
            vacant_count = len(unit_numbers) - occupied_target
            total_active += occupied_target
            total_vacant += vacant_count
            summary_lines.append(
                f"BLDG-{building:02d}: {occupied_target} occupied, {vacant_count} vacant, {len(unit_numbers)} total"
            )

            for floor_number, unit_number in unit_numbers:
                meter_number = f"WM-{building:02d}-{unit_number}"
                if unit_number in occupied_units:
                    resident_name = next_name(rng, used_names)
                    contact = f"09{contact_serial:09d}"
                    contact_serial += 1
                    account_number = f"ACC-{building:02d}-{unit_number}"
                    status = "active"
                else:
                    resident_name = ""
                    contact = ""
                    account_number = ""
                    status = "vacant"

                writer.writerow(
                    [
                        f"BLDG-{building:02d}",
                        floor_number,
                        unit_number,
                        meter_number,
                        status,
                        resident_name,
                        contact,
                        account_number,
                    ]
                )

    summary_lines.extend(
        [
            "",
            f"Grand total occupied units: {total_active}",
            f"Grand total vacant units: {total_vacant}",
            f"Grand total units: {total_active + total_vacant}",
            "",
            f"CSV: {CSV_PATH.name}",
            f"SQL: {SQL_PATH.name}",
        ]
    )
    SUMMARY_PATH.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")


def main() -> None:
    write_sql()
    write_csv_and_summary()
    print(f"Generated {CSV_PATH.name}")
    print(f"Generated {SQL_PATH.name}")
    print(f"Generated {SUMMARY_PATH.name}")


if __name__ == "__main__":
    main()
