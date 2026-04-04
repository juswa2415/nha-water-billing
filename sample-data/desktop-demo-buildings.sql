BEGIN TRANSACTION;

INSERT OR IGNORE INTO buildings (name, code, total_floors, sub_meter_number, notes)
VALUES
  ('Building 22', 'BLDG-22', 5, 'SM-22-0001', 'Demo building for desktop import testing'),
  ('Building 23', 'BLDG-23', 5, 'SM-23-0001', 'Demo building for desktop import testing');

WITH RECURSIVE floor_seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM floor_seq WHERE n < 5
)
INSERT OR IGNORE INTO floors (building_id, floor_number)
SELECT b.id, floor_seq.n
FROM buildings b
JOIN floor_seq
WHERE b.code IN ('BLDG-22', 'BLDG-23');

COMMIT;
