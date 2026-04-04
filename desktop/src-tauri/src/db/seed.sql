-- ================================================================
-- NHA CAMARIN WATER BILLING — SEED DATA
-- ================================================================
INSERT INTO system_settings (key, value, description) VALUES
  ('rate_per_cubicm',           '28.38',                       'Current rate per cubic meter in PhP'),
  ('organization_name',         'National Housing Authority',   'Organization name for bills/receipts'),
  ('district_office',           'Caloocan District Office',     'District office name'),
  ('community_name',            'Camarin Residences 3',         'Community/project name'),
  ('receipt_prefix',            '',                             'Prefix prepended to all receipt numbers'),
  ('receipt_next_number',       '1',                            'Next sequential receipt number'),
  ('disconnection_notice_days', '7',                            'Grace days after due date before disconnection'),
  ('penalty_rate',              '0',                            'Penalty rate % for late payment'),
  ('abnormal_spike_multiplier', '3',                            'Flag reading if consumption exceeds avg x N'),
  ('cashier_name_1',            'CRISTINA ALACEDA',             'Primary cashier name shown on bills'),
  ('cashier_name_2',            'LORENA SEVILLA',               'Secondary cashier name shown on bills'),
  ('payment_location',          'Camres 1 Livelihood Center',   'Payment venue shown on bills'),
  ('payment_schedule',          'every Tues, Thrs. & Fri. 9:30 AM - 12:00 PM', 'Payment hours shown on bills'),
  ('bill_correction_contact_1', 'MICHAEL HERNATO',              'Bill correction contact 1'),
  ('bill_correction_contact_2', 'JOEL TORRES',                  'Bill correction contact 2');