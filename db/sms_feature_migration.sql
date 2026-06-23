-- ─── SMS FEATURES MIGRATION ───────────────────────────────────────────────────
-- Run this in your Neon console or psql

-- 1. SMS usage tracking on companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sms_quota_monthly    INTEGER  NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS sms_used_this_month  INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_quota_reset_date DATE,
  ADD COLUMN IF NOT EXISTS at_sender_id         TEXT,        -- their own approved sender ID
  ADD COLUMN IF NOT EXISTS at_api_key           TEXT,        -- encrypted AT api key
  ADD COLUMN IF NOT EXISTS at_username          TEXT;        -- their AT username

-- 2. SMS templates per company
CREATE TABLE IF NOT EXISTS sms_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,  -- rent_reminder | payment_confirmation | overdue | penalty | custom_blast
  name         TEXT        NOT NULL,  -- display name
  template     TEXT        NOT NULL,  -- message with {tenant_name}, {amount}, {unit}, {month}, {due_date}, {receipt}, {paybill}, {account_ref}
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, type)
);

-- 3. Bulk SMS blasts (custom messages to groups)
CREATE TABLE IF NOT EXISTS sms_blasts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by      UUID        NOT NULL REFERENCES users(id),
  subject         TEXT        NOT NULL,   -- internal label e.g. "March rent increase notice"
  message         TEXT        NOT NULL,   -- the actual message sent
  target_type     TEXT        NOT NULL,   -- all | property | tenant
  target_id       UUID,                   -- property_id or tenant_id when targeted
  target_label    TEXT,                   -- human readable e.g. "Westgate Court" or "John Kamau"
  total_sent      INTEGER     NOT NULL DEFAULT 0,
  total_failed    INTEGER     NOT NULL DEFAULT 0,
  total_skipped   INTEGER     NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'pending',  -- pending | sending | done | failed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- 4. SMS usage log (every SMS sent, linked to company for billing)
CREATE TABLE IF NOT EXISTS sms_usage_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  notification_id UUID        REFERENCES notifications(id),
  blast_id        UUID        REFERENCES sms_blasts(id),
  phone           TEXT        NOT NULL,
  message_length  INTEGER     NOT NULL,
  sms_parts       INTEGER     NOT NULL DEFAULT 1,  -- 160 chars = 1 part, 161-306 = 2 parts etc.
  sender_id_used  TEXT,
  at_cost         NUMERIC(10,2),
  status          TEXT        NOT NULL,   -- sent | failed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Quota upgrade requests (when a company wants more SMS)
CREATE TABLE IF NOT EXISTS sms_quota_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requested_by UUID        NOT NULL REFERENCES users(id),
  current_quota INTEGER    NOT NULL,
  requested_quota INTEGER  NOT NULL,
  reason       TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  reviewed_by  UUID        REFERENCES users(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast usage queries
CREATE INDEX IF NOT EXISTS idx_sms_usage_company_month
  ON sms_usage_log (company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_sms_blasts_company
  ON sms_blasts (company_id, created_at DESC);

-- Insert default templates for all existing companies
INSERT INTO sms_templates (company_id, type, name, template)
SELECT
  c.id,
  t.type,
  t.name,
  t.template
FROM companies c
CROSS JOIN (VALUES
  ('rent_reminder',        'Rent Reminder',        'Dear {tenant_name}, your rent of KES {amount} for {month} is due on {due_date}. Pay via M-Pesa PayBill {paybill}, Account: {account_ref}.'),
  ('payment_confirmation', 'Payment Confirmation', 'Dear {tenant_name}, payment of KES {amount} for {month} received. Receipt: {receipt}. Thank you.'),
  ('overdue',              'Overdue Notice',       'Dear {tenant_name}, your rent of KES {amount} for {month} is overdue. Please pay immediately to avoid penalties.'),
  ('penalty',              'Penalty Notice',       'Dear {tenant_name}, a late payment penalty of KES {amount} has been added to your account for {month}.'),
  ('custom_blast',         'Announcement',         'Dear {tenant_name}, ')
) AS t(type, name, template)
WHERE c.deleted_at IS NULL
ON CONFLICT (company_id, type) DO NOTHING;