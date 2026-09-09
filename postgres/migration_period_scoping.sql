-- Kriterleri müdürlük ve tetkik ayı bazında birbirinden ayırır.
ALTER TABLE criteria
  ADD COLUMN IF NOT EXISTS audit_period varchar(7);

UPDATE criteria
SET audit_period = to_char(created_at, 'YYYY-MM')
WHERE audit_period IS NULL
   OR audit_period !~ '^\d{4}-(0[1-9]|1[0-2])$';

CREATE INDEX IF NOT EXISTS idx_criteria_area_period_status
  ON criteria(area_id, audit_period, approval_status, active);

