# Sample Data Pack

This folder gives you a minimal starter dataset for the desktop app.

## Files

- `desktop-demo-buildings.sql`
  Seeds two demo buildings with five floors each: `BLDG-22` and `BLDG-23`.
- `desktop-demo-units.csv`
  Ready-to-import CSV for the desktop app's **Units > Bulk Import** screen.
- `load_demo_buildings.py`
  One-time helper that applies the building/floor seed into the Tauri app database.
- `desktop-buildings-13-22.sql`
  Seeds buildings `BLDG-13` through `BLDG-22` with five floors each.
- `desktop-units-13-22.csv`
  Large sample import file for buildings `13-22`.
- `desktop-units-13-22-summary.txt`
  Summary of occupied and vacant counts per building.
- `generate_large_demo_data.py`
  Regenerates the large sample CSV/SQL files with a fixed random seed.
- `load_buildings_13_22.py`
  One-time helper that applies the `BLDG-13` to `BLDG-22` building/floor seed into the Tauri app database.
- `seed_full_demo_state.py`
  Seeds a fuller desktop/mobile demo state:
  imports the large units set, clears old billing-only data, creates historical billing cycles,
  inserts readings, bills, payments, and exports a current mobile reading-list JSON.
- `mobile-reading-list-current.json`
  Desktop-style reading list JSON for the latest seeded cycle.
- `demo-state-summary.txt`
  Summary of the full seeded demo state.

## Use It

1. Run the desktop app once so the database exists, then close the app.
2. From the project root, run:

```powershell
python .\sample-data\load_demo_buildings.py
```

3. Reopen the desktop app.
4. Go to **Units > Bulk Import**.
5. Choose `sample-data\desktop-demo-units.csv`.
6. Click **Import Units**.

## Notes

- The CSV matches the desktop import format exactly:
  `building_code,floor_number,unit_number,meter_number,status,resident_name,contact,account_number`
- A few rows intentionally leave `account_number` blank so the app can auto-generate them.
- A few units are marked `vacant`, `inactive`, or `disconnected` so you can test different statuses.

## Large Demo Set

Use this when you want a more realistic bulk import:

1. Run:

```powershell
python .\sample-data\generate_large_demo_data.py
python .\sample-data\load_buildings_13_22.py
```

2. Reopen the desktop app.
3. Go to **Units > Bulk Import**.
4. Use `sample-data\desktop-units-13-22.csv`.

The large set uses buildings `13` through `22` inclusive, which is `10` buildings.

## Full Demo State

Use this when you want the desktop app populated beyond just unit master data:

```powershell
python .\sample-data\seed_full_demo_state.py
```

This script:

- seeds buildings `13-22` and their floors
- imports or updates the large unit/account CSV
- clears old billing-cycle, reading, bill, and payment rows
- creates several billing cycles with mixed paid/unpaid history
- creates a current reading cycle for mobile/export testing
- writes `mobile-reading-list-current.json`
