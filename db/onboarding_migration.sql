-- ── PLATFORM SETTINGS (super admin configurable) ────────────────────────────
-- Key-value store for platform-wide settings super admin can adjust
-- e.g. trial_days, default_sms_quota, pricing info shown on website

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert defaults
INSERT INTO platform_settings (key, value, description) VALUES
  ('trial_days',           '7',    'Number of free trial days for new companies'),
  ('default_sms_quota',    '500',  'Default monthly SMS quota for new companies'),
  ('starter_price',        '2500', 'Starter plan monthly price in KES'),
  ('growth_price',         '5500', 'Growth plan monthly price in KES'),
  ('enterprise_price',     '12000','Enterprise plan monthly price in KES'),
  ('starter_units',        '50',   'Max units on Starter plan'),
  ('growth_units',         '200',  'Max units on Growth plan'),
  ('whatsapp_number',      '254759604215', 'WhatsApp support number'),
  ('support_email',        'support@propmanager.co.ke', 'Support email address')
ON CONFLICT (key) DO NOTHING;

-- ── SELF-SERVICE SUBSCRIPTION PAYMENTS ────────────────────────────────────────
-- Track IntaSend payment requests for subscription activation

CREATE TABLE IF NOT EXISTS subscription_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan              TEXT NOT NULL,
  amount            NUMERIC(10,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'KES',
  channel           TEXT NOT NULL DEFAULT 'mpesa',
  -- IntaSend refs
  intasend_invoice_id   TEXT,
  intasend_tracking_id  TEXT,
  api_ref           TEXT UNIQUE,   -- our internal ref sent to IntaSend
  phone             TEXT,
  -- Status lifecycle
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed','expired')),
  failure_reason    TEXT,
  -- Billing period activated
  billing_days      INTEGER DEFAULT 30,
  -- Timestamps
  initiated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  expired_at        TIMESTAMPTZ,
  webhook_payload   JSONB        -- raw webhook from IntaSend for debugging
);

CREATE INDEX IF NOT EXISTS idx_sub_payments_company ON subscription_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_api_ref ON subscription_payments(api_ref);
CREATE INDEX IF NOT EXISTS idx_sub_payments_status  ON subscription_payments(status);

-- ── TRIAL NOTIFICATION LOG ────────────────────────────────────────────────────
-- Prevent duplicate trial reminder SMS/emails

CREATE TABLE IF NOT EXISTS trial_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  days_before INTEGER NOT NULL,  -- 7, 3, 1, 0
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, days_before)
);