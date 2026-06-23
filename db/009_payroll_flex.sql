-- =====================================================================
-- 009_payroll_flex.sql  –  Flexible payroll: exemptions + tax reliefs
-- =====================================================================
-- Kenya KRA rules implemented:
--  1. NSSF computed on pensionable pay (basic only, not allowances)
--  2. Non-taxable allowance thresholds: house ≤3,000, transport ≤2,000
--  3. SHIF / AHL / NITA optional per employee (casual, exempt contracts)
--  4. Tax reliefs: disability, insurance premium, mortgage interest, pension
--  5. NSSF Tier II ceiling updated to 108,000 (effective Feb 2026)
-- =====================================================================

-- ─── Employee: statutory exemption flags ──────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS exempt_nssf        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exempt_shif        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exempt_ahl         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exempt_nita        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Tax relief fields (monthly KES amounts)
  ADD COLUMN IF NOT EXISTS disability_exemption    NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Personal disability relief: KES 2,400/mo extra on top of personal relief
  ADD COLUMN IF NOT EXISTS insurance_relief        NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- 15% of insurance premium paid, max KES 5,000/mo
  ADD COLUMN IF NOT EXISTS mortgage_relief         NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Mortgage interest relief, max KES 25,000/mo
  ADD COLUMN IF NOT EXISTS pension_relief          NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Registered pension/provident fund contributions, max KES 30,000/mo
  ADD COLUMN IF NOT EXISTS post_retirement_relief  NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Post-retirement medical fund, max KES 10,000/mo

  -- Non-taxable allowance overrides (NULL = use KRA default limits)
  -- KRA limits: house ≤3,000, transport ≤2,000 non-taxable
  -- Set these to override for specific employees (e.g. full house non-taxable
  -- for employees provided government/company housing)
  ADD COLUMN IF NOT EXISTS house_allowance_taxable_override     NUMERIC(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS transport_allowance_taxable_override NUMERIC(12,2) DEFAULT NULL;

-- ─── payroll_items: store relief breakdown for audit ──────────────────
ALTER TABLE payroll_items
  ADD COLUMN IF NOT EXISTS pensionable_pay        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS non_taxable_allowances NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_allowances     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tax_relief       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disability_exemption   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_relief       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mortgage_relief        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pension_relief         NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exempt_nssf            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exempt_shif            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exempt_ahl             BOOLEAN NOT NULL DEFAULT FALSE;