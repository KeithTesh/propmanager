-- Add SMS quota columns if not present
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_quota_monthly INTEGER DEFAULT 500;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_used_this_month INTEGER DEFAULT 0;

-- Sender ID approval requests
CREATE TABLE IF NOT EXISTS sender_id_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requested_by    UUID NOT NULL REFERENCES users(id),
  sender_id       TEXT NOT NULL,
  at_username     TEXT NOT NULL,
  at_api_key      TEXT NOT NULL,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  rejection_note  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sender_id_requests_company ON sender_id_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_sender_id_requests_status  ON sender_id_requests(status) WHERE status = 'pending';