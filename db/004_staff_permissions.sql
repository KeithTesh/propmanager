-- ============================================================
-- Staff permissions & caretaker property assignments
-- ============================================================

-- Caretaker permissions per company staff member
-- Each caretaker row defines which properties they cover + what they can do
CREATE TABLE IF NOT EXISTS caretaker_permissions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Which properties this caretaker is assigned to
  property_ids        UUID[] NOT NULL DEFAULT '{}',

  -- What they're allowed to do within those properties
  can_view_tenants    BOOLEAN NOT NULL DEFAULT FALSE,
  can_view_leases     BOOLEAN NOT NULL DEFAULT FALSE,
  can_view_billing    BOOLEAN NOT NULL DEFAULT FALSE,
  can_view_units      BOOLEAN NOT NULL DEFAULT TRUE,   -- on by default

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id)   -- one permissions row per caretaker
);

CREATE INDEX IF NOT EXISTS idx_caretaker_perms_company ON caretaker_permissions(company_id);
CREATE INDEX IF NOT EXISTS idx_caretaker_perms_user    ON caretaker_permissions(user_id);