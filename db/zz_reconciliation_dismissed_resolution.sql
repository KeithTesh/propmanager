ALTER TYPE unmatched_payment_resolution ADD VALUE IF NOT EXISTS 'dismissed';

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS deposit_waived_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_waived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS deposit_waived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_waive_reason TEXT;
