-- ============================================================
-- Manager property assignments
-- Managers with no assignments see ALL properties (fallback)
-- ============================================================

CREATE TABLE IF NOT EXISTS manager_property_assignments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_ids UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_mgr_assign_company ON manager_property_assignments(company_id);
CREATE INDEX IF NOT EXISTS idx_mgr_assign_user    ON manager_property_assignments(user_id);