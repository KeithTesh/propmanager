-- ============================================================
-- SMS FEATURES MIGRATION
-- Run this on Neon to enable sender ID requests, quota
-- requests, SMS usage logging, and SMS blast history.
-- ============================================================

-- ── sender_id_requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sender_id_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requested_by   UUID        NOT NULL REFERENCES users(id),
  sender_id      TEXT        NOT NULL,                        -- e.g. WESTGATE (max 11 chars)
  at_username    TEXT        NOT NULL,
  at_api_key     TEXT        NOT NULL,
  reason         TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected')),
  reviewed_by    UUID        REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  rejection_note TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sender_id_req_company ON sender_id_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_sender_id_req_status  ON sender_id_requests(status);

-- ── sms_quota_requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_quota_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requested_by     UUID        NOT NULL REFERENCES users(id),
  current_quota    INTEGER     NOT NULL,
  requested_quota  INTEGER     NOT NULL,
  reason           TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','approved','rejected')),
  reviewed_by      UUID        REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_note   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_quota_req_company ON sms_quota_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_sms_quota_req_status  ON sms_quota_requests(status);

-- ── sms_usage_log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_usage_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  blast_id         UUID,                                       -- NULL for individual SMS
  phone            TEXT        NOT NULL,
  message_length   INTEGER,
  sms_parts        INTEGER     NOT NULL DEFAULT 1,
  sender_id_used   TEXT,
  status           TEXT        NOT NULL DEFAULT 'sent'
                               CHECK (status IN ('sent','failed','pending')),
  at_message_id    TEXT,
  at_error         TEXT,
  at_cost          NUMERIC(8,4),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_usage_company    ON sms_usage_log(company_id);
CREATE INDEX IF NOT EXISTS idx_sms_usage_created_at ON sms_usage_log(created_at);

-- ── sms_blasts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_blasts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by     UUID        NOT NULL REFERENCES users(id),
  subject        TEXT        NOT NULL,
  message        TEXT        NOT NULL,
  target_type    TEXT        NOT NULL CHECK (target_type IN ('all','property','tenant')),
  target_id      UUID,
  target_label   TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','sending','done','failed')),
  total_sent     INTEGER     NOT NULL DEFAULT 0,
  total_failed   INTEGER     NOT NULL DEFAULT 0,
  total_skipped  INTEGER     NOT NULL DEFAULT 0,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_blasts_company ON sms_blasts(company_id);

-- ── sms_templates ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  template     TEXT        NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, type)
);

CREATE INDEX IF NOT EXISTS idx_sms_templates_company ON sms_templates(company_id);

-- ── subscription_payments ─────────────────────────────────────────────────────
-- (in case not already created)
CREATE TABLE IF NOT EXISTS subscription_payments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan             TEXT        NOT NULL,
  amount           NUMERIC(10,2) NOT NULL,
  channel          TEXT        NOT NULL DEFAULT 'mpesa_stk',
  phone            TEXT,
  api_ref          TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  failure_reason   TEXT,
  webhook_payload  JSONB,
  billing_days     INTEGER     DEFAULT 30,
  initiated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_payments_company ON subscription_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_api_ref ON subscription_payments(api_ref);
CREATE INDEX IF NOT EXISTS idx_sub_payments_status  ON subscription_payments(status);

-- ── subscription_events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL,
  old_status    TEXT,
  new_status    TEXT,
  old_plan      TEXT,
  new_plan      TEXT,
  amount        NUMERIC(10,2),
  notes         TEXT,
  performed_by  UUID        REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_company ON subscription_events(company_id);

-- ── trial_notifications ───────────────────────────────────────────────────────
-- Prevents duplicate trial reminder SMS/emails
CREATE TABLE IF NOT EXISTS trial_notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  days_left   INTEGER     NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, days_left)
);

-- ── Add SMS quota columns to companies if not present ─────────────────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sms_quota_monthly    INTEGER  NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS sms_used_this_month  INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_quota_reset_date DATE,
  ADD COLUMN IF NOT EXISTS at_sender_id         TEXT,
  ADD COLUMN IF NOT EXISTS at_username          TEXT,
  ADD COLUMN IF NOT EXISTS at_api_key           TEXT,
  ADD COLUMN IF NOT EXISTS owner_notify_sms     BOOLEAN  NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS owner_notify_email   BOOLEAN  NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS unit_limit           INTEGER  NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS units_used           INTEGER  NOT NULL DEFAULT 0;

-- ── Backfill units_used for existing companies ────────────────────────────────
UPDATE companies c SET
  units_used = (
    SELECT COUNT(*) FROM units u
    WHERE u.company_id = c.id AND u.deleted_at IS NULL
  ),
  updated_at = NOW()
WHERE c.deleted_at IS NULL;

-- ── Set sms_quota_reset_date for companies that don't have one ────────────────
UPDATE companies SET
  sms_quota_reset_date = DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
WHERE sms_quota_reset_date IS NULL AND deleted_at IS NULL;