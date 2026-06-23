-- ============================================================
-- PropManager Phase 3 — Agent Integration Migration
-- Run on Neon BEFORE any code changes
-- ============================================================

-- 1a. Add account_type to companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'landlord'
  CHECK (account_type IN ('landlord', 'agent'));

-- 1b. Add landlord_client to user_role enum
DO $$ BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'landlord_client';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1c. Add agent plan tiers
DO $$ BEGIN
  ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'starter_agent';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'growth_agent';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'enterprise_agent';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1d. Landlords table
CREATE TABLE IF NOT EXISTS landlords (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name        TEXT        NOT NULL,
  phone            TEXT,
  email            TEXT,
  kra_pin          TEXT,
  bank_name        TEXT,
  bank_account     TEXT,
  bank_branch      TEXT,
  commission_type  TEXT        NOT NULL DEFAULT 'percentage'
                               CHECK (commission_type IN ('flat','percentage')),
  commission_value NUMERIC(10,2) NOT NULL DEFAULT 10,
  user_id          UUID        REFERENCES users(id),
  invited_by       UUID        REFERENCES users(id),
  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','inactive')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_landlords_company  ON landlords(company_id);
CREATE INDEX IF NOT EXISTS idx_landlords_user     ON landlords(user_id);
CREATE INDEX IF NOT EXISTS idx_landlords_deleted  ON landlords(deleted_at) WHERE deleted_at IS NULL;

-- 1e. landlord_id on properties
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS landlord_id UUID REFERENCES landlords(id);

CREATE INDEX IF NOT EXISTS idx_properties_landlord ON properties(landlord_id);

-- 1f. Commission overrides (per-property rate that overrides landlord rate)
CREATE TABLE IF NOT EXISTS commission_overrides (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  landlord_id      UUID        NOT NULL REFERENCES landlords(id) ON DELETE CASCADE,
  property_id      UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  commission_type  TEXT        NOT NULL CHECK (commission_type IN ('flat','percentage')),
  commission_value NUMERIC(10,2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (landlord_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_comm_overrides_company  ON commission_overrides(company_id);
CREATE INDEX IF NOT EXISTS idx_comm_overrides_landlord ON commission_overrides(landlord_id);

-- 1g. Remittance statements
CREATE TABLE IF NOT EXISTS remittance_statements (
  id                        UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                UUID          NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  landlord_id               UUID          NOT NULL REFERENCES landlords(id),
  period_month              DATE          NOT NULL, -- first day of month e.g. 2026-04-01
  gross_collected           NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  expenses_deducted         NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_payable               NUMERIC(12,2) NOT NULL DEFAULT 0,
  status                    TEXT          NOT NULL DEFAULT 'draft'
                                          CHECK (status IN ('draft','sent','paid')),
  notes                     TEXT,
  notes_visible_to_landlord BOOLEAN       NOT NULL DEFAULT TRUE,
  dispute_flag              BOOLEAN       NOT NULL DEFAULT FALSE,
  payment_reference         TEXT,
  generated_by              UUID          REFERENCES users(id),
  sent_at                   TIMESTAMPTZ,
  paid_at                   TIMESTAMPTZ,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, landlord_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_remit_statements_company  ON remittance_statements(company_id);
CREATE INDEX IF NOT EXISTS idx_remit_statements_landlord ON remittance_statements(landlord_id);
CREATE INDEX IF NOT EXISTS idx_remit_statements_status   ON remittance_statements(status);

-- 1h. Remittance statement line items (per property)
CREATE TABLE IF NOT EXISTS remittance_statement_lines (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  statement_id      UUID          NOT NULL REFERENCES remittance_statements(id) ON DELETE CASCADE,
  property_id       UUID          NOT NULL REFERENCES properties(id),
  property_name     TEXT          NOT NULL,
  unit_count        INTEGER       NOT NULL DEFAULT 0,
  occupied_units    INTEGER       NOT NULL DEFAULT 0,
  amount_billed     NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_collected  NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_type   TEXT          NOT NULL,
  commission_rate   NUMERIC(10,4) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  expenses_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remit_lines_statement ON remittance_statement_lines(statement_id);

-- 1i. Remittance disputes
CREATE TABLE IF NOT EXISTS remittance_disputes (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  statement_id   UUID        NOT NULL REFERENCES remittance_statements(id) ON DELETE CASCADE,
  landlord_id    UUID        NOT NULL REFERENCES landlords(id),
  reason         TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','agent_responded','resolved','escalated')),
  agent_response TEXT,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disputes_statement ON remittance_disputes(statement_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status    ON remittance_disputes(status);

-- ── Verification queries (run after migration to confirm) ─────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'companies' AND column_name = 'account_type';
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('landlords','commission_overrides','remittance_statements',
--                      'remittance_statement_lines','remittance_disputes');