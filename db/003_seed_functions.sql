-- ============================================================
-- PROPMANAGER — PHASE 1 DATABASE SCHEMA
-- Migration 003: Seed Data & Reference Tables
-- ============================================================

-- ============================================================
-- TABLE: bank_reference_data
-- Pre-built bank info for CSV mapper and PayBill display
-- ============================================================
CREATE TABLE bank_reference_data (
  id              SERIAL PRIMARY KEY,
  bank_name       TEXT NOT NULL UNIQUE,
  paybill_number  TEXT,
  swift_code      TEXT,
  pesalink_code   TEXT,
  country         TEXT DEFAULT 'KE',
  logo_url        TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  -- API tier supported by this bank
  supports_ipn    BOOLEAN DEFAULT FALSE,  -- Tier 2 capable
  supports_h2h    BOOLEAN DEFAULT FALSE,  -- Tier 3 H2H
  api_doc_url     TEXT
);

-- Seed: Kenyan banks with PayBill numbers and tier info
INSERT INTO bank_reference_data
  (bank_name, paybill_number, swift_code, pesalink_code, supports_ipn, supports_h2h, api_doc_url)
VALUES
  ('Equity Bank',       '247247', 'EQBLKENA', '63',  TRUE,  FALSE, 'https://www.jengaapi.io/'),
  ('KCB Bank',          '522522', 'KCBLKENA', '01',  TRUE,  FALSE, 'https://buni.kcbgroup.com/'),
  ('ABSA Bank',         '303030', 'BARCKENX', '03',  FALSE, TRUE,  'https://www.absabank.co.ke/'),
  ('Co-operative Bank', '400222', 'KCOOKENA', '11',  TRUE,  FALSE, 'https://developer.co-opbank.co.ke:9443/store/'),
  ('NCBA Bank',         '880100', 'CBAFKENA', '07',  TRUE,  FALSE, 'https://ke.ncbagroup.com/payment-solution/'),
  ('I&M Bank',          '542542', 'IMBLKENA', '57',  TRUE,  TRUE,  'https://www.imbankgroup.com/ke/business-solutions/business-connect/'),
  ('Standard Chartered','329329', 'SCBLKENX', '02',  FALSE, FALSE, NULL),
  ('DTB Bank',          '516600', 'DTKEKENA', '63',  FALSE, FALSE, NULL),
  ('Family Bank',       '222111', 'FABLKENA', '70',  FALSE, FALSE, NULL),
  ('Stanbic Bank',      '600100', 'SBICKENA', '31',  FALSE, FALSE, NULL),
  ('Diamond Trust Bank','516600', 'DTKEKENA', '63',  FALSE, FALSE, NULL),
  ('Sidian Bank',       '713713', NULL,        NULL, FALSE, FALSE, NULL),
  ('HFC Bank',          '100400', NULL,        NULL, FALSE, FALSE, NULL),
  ('National Bank',     '625625', 'NBKEKENA', '12',  FALSE, FALSE, NULL),
  ('Consolidated Bank', '262262', NULL,        NULL, FALSE, FALSE, NULL);

-- ============================================================
-- Seed: CSV bank templates for the 4 main banks
-- These ship with PropManager as defaults
-- ============================================================

-- Note: company_id is NULL for system defaults
-- When a company uploads a CSV, if no company-specific
-- template exists, system defaults are used as starting point

CREATE TABLE csv_default_templates (
  id              SERIAL PRIMARY KEY,
  bank_name       TEXT NOT NULL UNIQUE,
  template_name   TEXT NOT NULL,
  col_transaction_ref   TEXT,
  col_transaction_date  TEXT,
  col_amount            TEXT,
  col_payer_name        TEXT,
  col_payer_reference   TEXT,
  col_narration         TEXT,
  col_balance           TEXT,
  date_format           TEXT,
  header_rows_to_skip   SMALLINT DEFAULT 1,
  sample_headers        TEXT[]   -- actual header row from this bank's export
);

INSERT INTO csv_default_templates VALUES
(DEFAULT, 'Equity Bank', 'Equity Bank Standard',
  'Transaction ID', 'Transaction Date', 'Debit Amount',
  'Sender Name', 'Account Number', 'Narration',
  'Running Balance', 'DD/MM/YYYY', 1,
  ARRAY['Transaction ID','Transaction Date','Value Date','Debit Amount','Credit Amount','Sender Name','Account Number','Narration','Running Balance']),

(DEFAULT, 'KCB Bank', 'KCB Bank Standard',
  'Reference', 'Transaction Date', 'Credit',
  'Description', 'Account', 'Narration',
  'Balance', 'DD/MM/YYYY', 1,
  ARRAY['Reference','Transaction Date','Debit','Credit','Description','Account','Narration','Balance']),

(DEFAULT, 'ABSA Bank', 'ABSA Bank Standard',
  'Transaction Reference', 'Posting Date', 'Credit Amount',
  'Beneficiary/Payer', 'Account Reference', 'Transaction Description',
  'Balance', 'YYYY-MM-DD', 1,
  ARRAY['Transaction Reference','Posting Date','Debit Amount','Credit Amount','Beneficiary/Payer','Account Reference','Transaction Description','Balance']),

(DEFAULT, 'Co-operative Bank', 'Co-op Bank Standard',
  'Trans Ref', 'Value Date', 'Credit',
  'Customer Name', 'Account Reference', 'Narration',
  'Balance', 'DD/MM/YYYY', 1,
  ARRAY['Trans Ref','Value Date','Debit','Credit','Customer Name','Account Reference','Narration','Balance']),

(DEFAULT, 'I&M Bank', 'I&M Bank Standard',
  'Trans Ref No', 'Transaction Date', 'Credit Amount',
  'Customer Name', 'Reference', 'Description',
  'Running Balance', 'DD-MMM-YYYY', 1,
  ARRAY['Trans Ref No','Transaction Date','Debit Amount','Credit Amount','Customer Name','Reference','Description','Running Balance']);

-- ============================================================
-- TABLE: statutory_rates
-- Phase 2 payroll engine reads from here by payroll_month
-- Seeded now so the table exists and Phase 2 can populate it
-- SIM-Q1: rates versioned with effective_from/effective_to
-- ============================================================
CREATE TABLE statutory_rates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rate_type       TEXT NOT NULL,         -- 'PAYE_BANDS','NSSF','SHIF','AHL','NITA','PERSONAL_RELIEF'
  effective_from  DATE NOT NULL,
  effective_to    DATE,                  -- NULL = currently in force
  parameters      JSONB NOT NULL,        -- rate-specific structure
  source_reference TEXT,                 -- e.g. 'KRA Gazette Notice 2025/12'
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (rate_type, effective_from)
);

CREATE INDEX idx_statutory_rates_type_date ON statutory_rates(rate_type, effective_from DESC);

-- Seed 2026 statutory rates (from simulation research)
INSERT INTO statutory_rates (rate_type, effective_from, effective_to, parameters, source_reference, notes) VALUES

-- PAYE bands (effective from 2023 Finance Act, current as of 2026)
('PAYE_BANDS', '2023-07-01', NULL, '{
  "bands": [
    {"from": 0,       "to": 24000,  "rate": 0.10},
    {"from": 24001,   "to": 32333,  "rate": 0.25},
    {"from": 32334,   "to": 500000, "rate": 0.30},
    {"from": 500001,  "to": 800000, "rate": 0.325},
    {"from": 800001,  "to": null,   "rate": 0.35}
  ],
  "currency": "KES",
  "period": "monthly"
}', 'Finance Act 2023', 'Current PAYE bands as of 2026'),

-- Personal relief (monthly)
('PERSONAL_RELIEF', '2023-01-01', NULL, '{
  "monthly_relief": 2400,
  "annual_relief": 28800,
  "currency": "KES"
}', 'Finance Act 2023', NULL),

-- NSSF Tier I/II (effective Feb 2026 — UEL raised to KES 108,000)
('NSSF', '2026-02-01', NULL, '{
  "tier_1_lel": 9000,
  "tier_1_rate": 0.06,
  "tier_1_max_employee": 540,
  "tier_1_max_employer": 540,
  "tier_2_uel": 108000,
  "tier_2_rate": 0.06,
  "tier_2_max_employee": 3780,
  "tier_2_max_employer": 3780,
  "total_max_employee": 4320,
  "total_max_employer": 4320,
  "currency": "KES"
}', 'NSSF Act 2013 — 4th Year Schedule', 'UEL raised from 72,000 to 108,000 effective Feb 2026'),

-- Previous NSSF rates (Feb 2025 – Jan 2026)
('NSSF', '2025-02-01', '2026-01-31', '{
  "tier_1_lel": 8000,
  "tier_1_rate": 0.06,
  "tier_1_max_employee": 480,
  "tier_1_max_employer": 480,
  "tier_2_uel": 72000,
  "tier_2_rate": 0.06,
  "tier_2_max_employee": 3840,
  "tier_2_max_employer": 3840,
  "total_max_employee": 4320,
  "total_max_employer": 4320,
  "currency": "KES"
}', 'NSSF Act 2013 — 3rd Year Schedule', NULL),

-- SHIF (effective Oct 2024, replaced NHIF)
('SHIF', '2024-10-01', NULL, '{
  "rate": 0.0275,
  "minimum_contribution": 300,
  "maximum_contribution": null,
  "employer_match": false,
  "tax_deductible_from": "2024-12-27",
  "currency": "KES"
}', 'Social Health Insurance Act 2024', 'NHIF replaced by SHIF from Oct 1 2024'),

-- AHL — Affordable Housing Levy (effective March 2024)
('AHL', '2024-03-01', NULL, '{
  "employee_rate": 0.015,
  "employer_rate": 0.015,
  "maximum": null,
  "filing_form": "P10 Sheet M",
  "tax_deductible_from": "2024-12-01",
  "currency": "KES"
}', 'Affordable Housing Act 2024', 'Both employer and employee contribute 1.5%'),

-- NITA levy (employer only, per employee)
('NITA', '2023-01-01', NULL, '{
  "levy_per_employee_per_month": 50,
  "currency": "KES",
  "employer_only": true
}', 'Industrial Training Act Cap 237', 'KES 50 per employee per month'),

-- Non-resident PAYE flat rate
('PAYE_NON_RESIDENT', '2023-01-01', NULL, '{
  "flat_rate": 0.30,
  "personal_relief": false,
  "currency": "KES"
}', 'Income Tax Act', NULL);

-- ============================================================
-- TABLE: kenya_public_holidays
-- Used by statutory deadline alert system (SIM-S4)
-- ============================================================
CREATE TABLE kenya_public_holidays (
  id          SERIAL PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  is_recurring BOOLEAN DEFAULT TRUE  -- TRUE = repeats annually same date
);

INSERT INTO kenya_public_holidays (holiday_date, name) VALUES
-- 2026 public holidays
('2026-01-01', 'New Year''s Day'),
('2026-04-03', 'Good Friday'),
('2026-04-06', 'Easter Monday'),
('2026-05-01', 'Labour Day'),
('2026-06-01', 'Madaraka Day'),
('2026-10-10', 'Huduma Day'),
('2026-10-20', 'Mashujaa Day'),
('2026-12-12', 'Jamhuri Day'),
('2026-12-25', 'Christmas Day'),
('2026-12-26', 'Boxing Day'),
-- 2027 (extend annually via cron)
('2027-01-01', 'New Year''s Day'),
('2027-04-02', 'Good Friday'),
('2027-04-05', 'Easter Monday'),
('2027-05-01', 'Labour Day'),
('2027-06-01', 'Madaraka Day'),
('2027-10-10', 'Huduma Day'),
('2027-10-20', 'Mashujaa Day'),
('2027-12-12', 'Jamhuri Day'),
('2027-12-25', 'Christmas Day'),
('2027-12-26', 'Boxing Day');

-- ============================================================
-- FUNCTION: is_statutory_deadline_safe(check_date DATE)
-- Returns TRUE if check_date is safe to remit
-- Returns FALSE if it falls on weekend or public holiday
-- SIM-S4: used for deadline alert logic
-- ============================================================
CREATE OR REPLACE FUNCTION is_statutory_deadline_safe(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
  -- Weekend check
  IF EXTRACT(DOW FROM check_date) IN (0, 6) THEN
    RETURN FALSE;
  END IF;
  -- Public holiday check
  IF EXISTS (SELECT 1 FROM kenya_public_holidays WHERE holiday_date = check_date) THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- FUNCTION: proration_engine(...)
-- The single shared proration function used by both:
--   1. Lease creation wizard (First Bill Preview)
--   2. Billing cron
-- Rec 26: one function, no duplicate logic
-- Rec 27: always floor() to nearest whole shilling
-- ============================================================
CREATE OR REPLACE FUNCTION proration_engine(
  monthly_rent      NUMERIC,
  move_in_date      DATE,
  proration_mode    proration_mode,
  proration_cutoff  SMALLINT,        -- only used for 'after_cutoff' mode
  proration_method  proration_method,
  min_threshold     INTEGER DEFAULT 500
)
RETURNS TABLE (
  is_prorated           BOOLEAN,
  proration_days        SMALLINT,
  days_in_month         SMALLINT,
  daily_rate            NUMERIC,
  prorated_amount       NUMERIC,
  full_month_amount     NUMERIC,
  bill_amount           NUMERIC,      -- what to actually charge
  description           TEXT          -- human-readable formula
) AS $$
DECLARE
  v_day_of_month    SMALLINT;
  v_days_in_month   SMALLINT;
  v_days_occupied   SMALLINT;
  v_daily_rate      NUMERIC;
  v_prorated        NUMERIC;
  v_should_prorate  BOOLEAN;
BEGIN
  v_day_of_month  := EXTRACT(DAY FROM move_in_date)::SMALLINT;
  v_days_in_month := EXTRACT(DAY FROM
                       (DATE_TRUNC('month', move_in_date) + INTERVAL '1 month - 1 day')
                     )::SMALLINT;
  v_days_occupied := v_days_in_month - v_day_of_month + 1;

  -- Determine whether to prorate based on mode
  v_should_prorate := CASE proration_mode
    WHEN 'always'        THEN v_day_of_month > 1
    WHEN 'after_cutoff'  THEN v_day_of_month > COALESCE(proration_cutoff, 1)
    WHEN 'never'         THEN FALSE
  END;

  IF NOT v_should_prorate OR v_day_of_month = 1 THEN
    -- Full month — no proration
    RETURN QUERY SELECT
      FALSE::BOOLEAN,
      NULL::SMALLINT,
      v_days_in_month,
      NULL::NUMERIC,
      NULL::NUMERIC,
      monthly_rent,
      monthly_rent,
      'Full month rent: KES ' || TRIM(TO_CHAR(monthly_rent, '999,999,990.00'));
    RETURN;
  END IF;

  -- Compute daily rate and prorated amount
  v_daily_rate := CASE proration_method
    WHEN 'actual_days' THEN monthly_rent / v_days_in_month
    WHEN 'standard_30' THEN monthly_rent / 30.0
  END;

  -- Rec 27: always FLOOR to nearest whole shilling
  v_prorated := FLOOR(v_daily_rate * v_days_occupied);

  -- Apply minimum threshold (SIM-M1)
  IF v_prorated < min_threshold THEN
    RETURN QUERY SELECT
      FALSE::BOOLEAN,
      NULL::SMALLINT,
      v_days_in_month,
      NULL::NUMERIC,
      v_prorated,
      monthly_rent,
      monthly_rent,   -- charge full month — below threshold
      'Prorated amount KES ' || v_prorated ||
      ' is below minimum threshold KES ' || min_threshold ||
      ' — full month charged';
    RETURN;
  END IF;

  -- Rec 28: always show formula in description
  RETURN QUERY SELECT
    TRUE::BOOLEAN,
    v_days_occupied::SMALLINT,
    CASE proration_method
      WHEN 'actual_days' THEN v_days_in_month
      WHEN 'standard_30' THEN 30::SMALLINT
    END,
    FLOOR(v_daily_rate * 100) / 100,  -- daily rate to 2dp
    v_prorated,
    monthly_rent,
    v_prorated,
    v_days_occupied || ' days × KES ' ||
    TRIM(TO_CHAR(FLOOR(v_daily_rate * 100) / 100, '999,999,990.00')) ||
    '/day = KES ' ||
    TRIM(TO_CHAR(v_prorated, '999,999,990'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- FUNCTION: next_statutory_deadline(base_date DATE)
-- Returns the safe remittance date at or before base_date
-- SIM-S4: used to determine if early remittance needed
-- ============================================================
CREATE OR REPLACE FUNCTION next_statutory_deadline(base_date DATE)
RETURNS DATE AS $$
DECLARE
  check_date DATE := base_date;
BEGIN
  WHILE NOT is_statutory_deadline_safe(check_date) LOOP
    check_date := check_date - INTERVAL '1 day';
  END LOOP;
  RETURN check_date;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- GRANTS
-- Dedicated roles for the app (follows least-privilege)
-- ============================================================

-- App role: used by the API server (PgBouncer pooled connection)
-- Rec 41: PgBouncer pooled connection string everywhere
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'propmanager_app') THEN
    CREATE ROLE propmanager_app LOGIN PASSWORD 'CHANGE_IN_ENV';
  END IF;
END $$;

-- App role: read/write on all tables, execute on functions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO propmanager_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO propmanager_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO propmanager_app;

-- Audit role: writes to audit_logs only, bypasses RLS
-- Used by the audit trigger service
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'propmanager_audit') THEN
    CREATE ROLE propmanager_audit LOGIN PASSWORD 'CHANGE_IN_ENV';
  END IF;
END $$;

GRANT INSERT ON audit_logs TO propmanager_audit;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
-- audit role bypasses RLS for INSERT
CREATE POLICY audit_insert_bypass ON audit_logs
  FOR INSERT
  TO propmanager_audit
  WITH CHECK (TRUE);

-- Read-only role: for reporting queries against read replica
-- Rec 42: Neon read replica for all report queries
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'propmanager_reader') THEN
    CREATE ROLE propmanager_reader LOGIN PASSWORD 'CHANGE_IN_ENV';
  END IF;
END $$;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO propmanager_reader;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO propmanager_reader;
