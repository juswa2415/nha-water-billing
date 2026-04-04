BEGIN TRANSACTION;

INSERT OR IGNORE INTO buildings (name, code, total_floors, sub_meter_number, notes)
VALUES
  ('Building 13', 'BLDG-13', 5, 'SM-13-0001', 'Large demo building seed'),
  ('Building 14', 'BLDG-14', 5, 'SM-14-0001', 'Large demo building seed'),
  ('Building 15', 'BLDG-15', 5, 'SM-15-0001', 'Large demo building seed'),
  ('Building 16', 'BLDG-16', 5, 'SM-16-0001', 'Large demo building seed'),
  ('Building 17', 'BLDG-17', 5, 'SM-17-0001', 'Large demo building seed'),
  ('Building 18', 'BLDG-18', 5, 'SM-18-0001', 'Large demo building seed'),
  ('Building 19', 'BLDG-19', 5, 'SM-19-0001', 'Large demo building seed'),
  ('Building 20', 'BLDG-20', 5, 'SM-20-0001', 'Large demo building seed'),
  ('Building 21', 'BLDG-21', 5, 'SM-21-0001', 'Large demo building seed'),
  ('Building 22', 'BLDG-22', 5, 'SM-22-0001', 'Large demo building seed');

WITH RECURSIVE floor_seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM floor_seq WHERE n < 5
)
INSERT OR IGNORE INTO floors (building_id, floor_number)
SELECT b.id, floor_seq.n
FROM buildings b
JOIN floor_seq
WHERE b.code IN ('BLDG-13', 'BLDG-14', 'BLDG-15', 'BLDG-16', 'BLDG-17', 'BLDG-18', 'BLDG-19', 'BLDG-20', 'BLDG-21', 'BLDG-22');

COMMIT;
