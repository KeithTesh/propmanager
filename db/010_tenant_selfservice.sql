-- =====================================================================
-- 010_tenant_selfservice.sql  –  Tenant self-service features
-- =====================================================================

-- ─── leases: add vacate_date (intended move-out, set by tenant notice) ─
ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS vacate_date DATE;

-- ─── lease_extension_requests ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lease_extension_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  lease_id            UUID NOT NULL REFERENCES leases(id),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  property_id         UUID NOT NULL REFERENCES properties(id),
  current_end_date    DATE,
  requested_end_date  DATE NOT NULL,
  message             TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  review_notes        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lease_ext_requests_company  ON lease_extension_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_lease_ext_requests_lease    ON lease_extension_requests(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_ext_requests_status   ON lease_extension_requests(status);

-- RLS
ALTER TABLE lease_extension_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_isolation ON lease_extension_requests;
CREATE POLICY company_isolation ON lease_extension_requests
  USING (company_id = current_setting('app.current_company_id', true)::uuid);