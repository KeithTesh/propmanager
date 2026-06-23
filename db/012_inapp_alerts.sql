-- =====================================================================
-- 012_inapp_alerts.sql  –  In-app notification alerts for staff
-- =====================================================================
-- Separate from the SMS notifications table.
-- These are dashboard alerts for managers/owners/finance/caretakers.

CREATE TABLE IF NOT EXISTS inapp_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- who sees it
  type        TEXT NOT NULL,  -- 'payment_received' | 'bill_overdue' | 'maintenance_request'
                               -- | 'lease_expiring' | 'expense_pending' | 'extension_request'
                               -- | 'vacate_notice' | 'payroll_ready' | 'system'
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  link        TEXT,           -- optional frontend route e.g. '/leases'
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inapp_alerts_user    ON inapp_alerts(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_inapp_alerts_company ON inapp_alerts(company_id);
CREATE INDEX IF NOT EXISTS idx_inapp_alerts_unread  ON inapp_alerts(user_id) WHERE read_at IS NULL;

ALTER TABLE inapp_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON inapp_alerts;
CREATE POLICY company_isolation ON inapp_alerts
  USING (company_id = current_setting('app.current_company_id', true)::uuid);