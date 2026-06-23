-- PropManager subscription management schema
-- Adds subscription tracking to companies table

-- Subscription plan enum
CREATE TYPE subscription_plan AS ENUM ('trial', 'starter', 'growth', 'pro', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'suspended', 'cancelled', 'expired');

-- Add subscription columns to companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS plan                subscription_plan   NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS subscription_status subscription_status NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS trial_ends_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason   TEXT,
  ADD COLUMN IF NOT EXISTS monthly_fee         NUMERIC(10,2)       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_limit          INTEGER             NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS units_used          INTEGER             NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_billed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_billing_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_email       TEXT,
  ADD COLUMN IF NOT EXISTS notes               TEXT;

-- Set trial defaults for existing companies (30-day trial from creation)
UPDATE companies SET
  plan                = 'trial',
  subscription_status = 'trialing',
  trial_ends_at       = created_at + INTERVAL '30 days'
WHERE subscription_status IS NULL OR plan IS NULL;

-- Subscription events log
CREATE TABLE IF NOT EXISTS subscription_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL, -- 'activated','suspended','cancelled','plan_changed','trial_started','payment_received'
  old_status    TEXT,
  new_status    TEXT,
  old_plan      TEXT,
  new_plan      TEXT,
  amount        NUMERIC(10,2),
  notes         TEXT,
  performed_by  UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sub_events_company ON subscription_events(company_id);
CREATE INDEX idx_sub_events_created ON subscription_events(created_at DESC);