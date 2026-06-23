-- =====================================================================
-- 011_snapshots_and_extensions.sql
-- =====================================================================

-- ─── financial_periods: add snapshot columns ──────────────────────────
ALTER TABLE financial_periods
  ADD COLUMN IF NOT EXISTS snap_total_revenue       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS snap_total_expenses      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS snap_total_payroll       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS snap_total_arrears       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS snap_total_payments      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS snap_active_leases       INTEGER,
  ADD COLUMN IF NOT EXISTS snap_occupancy_rate      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS snap_generated_at        TIMESTAMPTZ,
  -- governance columns added in 008 but may not exist yet
  ADD COLUMN IF NOT EXISTS force_closed             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS force_close_notes        TEXT,
  ADD COLUMN IF NOT EXISTS locked_reason            TEXT;