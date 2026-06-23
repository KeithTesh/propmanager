-- Add 'archived' to payroll_run_status enum
ALTER TYPE payroll_run_status ADD VALUE IF NOT EXISTS 'archived';

-- Add archived_at timestamp column
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;