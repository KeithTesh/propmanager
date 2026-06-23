-- ============================================================
-- PROPMANAGER — PHASE 1 DATABASE SCHEMA
-- Migration 001: Core Tables
-- 
-- Decisions locked:
--   D1: CSV import now, Daraja C2B in Phase 2
--   D2: Prorated first month collected at lease signing
--   D3: CSV column mapper in Phase 1
--   D4: Company chooses proration method at setup
--   D5: lease_tenants join table
--   D6: Payroll in Phase 2
--
-- Simulations: Reports I–IV (95 scenarios, 72 recommendations)
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- fuzzy matching for unmatched payments queue (SIM-P5)

-- ============================================================
-- ENUMS
-- All enums defined before tables that reference them
-- ============================================================

CREATE TYPE company_payment_method AS ENUM (
  'bank_paybill',   -- manual CSV reconciliation (Phase 1)
  'daraja_stk',     -- tenant-initiated STK push
  'cash',           -- physical cash, digitally recorded
  'manual'          -- fully manual record-keeping
);

CREATE TYPE proration_mode AS ENUM (
  'always',         -- always prorate partial months
  'after_cutoff',   -- prorate only if move-in after cutoff day
  'never'           -- always charge full month
);

CREATE TYPE proration_method AS ENUM (
  'actual_days',    -- divide by real days in month (Feb=28/29)
  'standard_30'     -- always divide by 30
);

CREATE TYPE move_out_proration_mode AS ENUM (
  'full_month',         -- always charge full final month
  'to_notice_date',     -- prorate to stated move-out date
  'to_actual_date'      -- prorate to actual vacate date
);

CREATE TYPE lease_status AS ENUM (
  'draft',          -- being configured, not yet active
  'active',         -- currently running
  'notice',         -- tenant served notice, winding down
  'terminated',     -- ended early
  'expired'         -- natural end of fixed term
);

CREATE TYPE bill_status AS ENUM (
  'draft',                            -- generated but not yet published
  'open',                             -- published, payment due
  'partial',                          -- some payment received
  'paid',                             -- fully settled
  'overdue',                          -- past due date, unpaid
  'payment_received_pending_verification', -- bank payment recorded, awaiting reconciliation (SIM-N1)
  'waived',                           -- manager waived the bill
  'void'                              -- cancelled
);

CREATE TYPE payment_channel AS ENUM (
  'mpesa_stk',        -- tenant-initiated STK push
  'mpesa_paybill',    -- tenant paid via PayBill (CSV-reconciled)
  'cash',             -- physical cash
  'bank_transfer',    -- bank EFT or direct transfer
  'adjustment',       -- credit/debit adjustment by manager
  'reversal'          -- payment reversal
);

CREATE TYPE stk_status AS ENUM (
  'pending',      -- STK push sent, awaiting PIN
  'confirmed',    -- payment confirmed by Daraja callback
  'failed',       -- Daraja returned error
  'expired',      -- 60–90s timeout with no response
  'cancelled'     -- user pressed cancel
);

CREATE TYPE notification_channel AS ENUM (
  'sms',
  'email',
  'whatsapp'  -- Phase 3, defined now for forward-compatibility
);

CREATE TYPE notification_status AS ENUM (
  'queued',
  'sent',
  'delivered',
  'failed',
  'cancelled',
  'permanent_failure'  -- 3 retries exhausted (SIM-O2)
);

CREATE TYPE user_role AS ENUM (
  'super_admin',   -- PropManager platform staff
  'owner',         -- company owner, full access
  'manager',       -- property manager
  'finance',       -- finance/accounts role
  'caretaker',     -- on-site caretaker, limited access
  'tenant'         -- tenant portal user
);

CREATE TYPE maintenance_status AS ENUM (
  'open',
  'in_progress',
  'resolved',
  'closed'
);

CREATE TYPE maintenance_priority AS ENUM (
  'low',
  'medium',
  'high',
  'urgent'
);

CREATE TYPE unmatched_payment_resolution AS ENUM (
  'assigned',        -- matched to a lease
  'wrong_property',  -- payment belongs to another landlord
  'written_off',     -- approved write-off
  'pending'          -- still unresolved
);

-- ============================================================
-- TABLE: companies
-- One row per property management company (multi-tenant root)
-- ============================================================
CREATE TABLE companies (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identity
  name                      TEXT NOT NULL,
  trading_name              TEXT,
  registration_number       TEXT,
  kra_pin                   TEXT,
  phone                     TEXT NOT NULL,
  email                     TEXT NOT NULL,
  address                   TEXT,
  county                    TEXT,
  logo_url                  TEXT,

  -- Payment configuration (Decision 1: CSV now, C2B later)
  payment_method            company_payment_method NOT NULL DEFAULT 'cash',
  paybill_number            TEXT,            -- M-Pesa PayBill shortcode
  paybill_account_format    TEXT,            -- e.g. 'UNIT-{lease_id}' template
  till_number               TEXT,            -- Buy Goods till
  bank_name                 TEXT,            -- for bank_paybill mode
  bank_account_number       TEXT,
  bank_branch               TEXT,

  -- Daraja credentials (encrypted, Phase 2 population)
  daraja_consumer_key_enc   TEXT,
  daraja_consumer_secret_enc TEXT,
  daraja_passkey_enc        TEXT,
  daraja_shortcode          TEXT,

  -- Proration settings (Decision 4: company chooses — no forced default)
  -- Stored on company AND snapshotted on each lease at creation
  move_in_proration_mode    proration_mode,           -- NULL = not yet configured
  move_in_proration_cutoff  SMALLINT CHECK (move_in_proration_cutoff BETWEEN 1 AND 28),
  move_in_proration_method  proration_method,
  move_out_proration_mode   move_out_proration_mode,
  bill_first_partial_month  BOOLEAN DEFAULT TRUE,     -- FALSE = start billing 1st of next month
  min_proration_threshold   INTEGER DEFAULT 500,      -- KES; below this, treat as mode=never

  -- Billing config
  due_day                   SMALLINT DEFAULT 1 CHECK (due_day BETWEEN 1 AND 28),
  grace_period_days         SMALLINT DEFAULT 0,
  penalty_type              TEXT DEFAULT 'none' CHECK (penalty_type IN ('none','flat','percentage')),
  penalty_value             NUMERIC(12,2) DEFAULT 0,
  penalty_applies_after_days SMALLINT DEFAULT 0,

  -- Notifications
  sms_sender_id             TEXT,            -- Africa's Talking sender ID
  reminder_days_before      SMALLINT[] DEFAULT ARRAY[7,3,0],  -- days before due
  reminder_days_after       SMALLINT[] DEFAULT ARRAY[3],      -- days after due

  -- Setup wizard (SIM-N3: linear blocking wizard)
  setup_completed           BOOLEAN DEFAULT FALSE,
  setup_current_step        SMALLINT DEFAULT 1,

  -- Audit
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ  -- soft delete
);

CREATE INDEX idx_companies_email ON companies(email);
CREATE INDEX idx_companies_deleted ON companies(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- TABLE: company_setup_progress
-- Tracks wizard step completion for recovery (SIM-O4)
-- ============================================================
CREATE TABLE company_setup_progress (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  step_number     SMALLINT NOT NULL,
  step_name       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped')),
  completed_at    TIMESTAMPTZ,
  data_snapshot   JSONB,  -- what was saved at this step
  UNIQUE (company_id, step_number)
);

-- ============================================================
-- TABLE: users
-- All humans who log into PropManager
-- ============================================================
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID REFERENCES companies(id) ON DELETE SET NULL,  -- NULL for super_admin
  role            user_role NOT NULL DEFAULT 'tenant',
  email           TEXT NOT NULL,
  phone           TEXT,
  full_name       TEXT NOT NULL,
  avatar_url      TEXT,
  password_hash   TEXT,            -- NULL if Google OAuth only
  google_sub      TEXT,            -- Google OAuth subject
  is_active       BOOLEAN DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,

  -- Notification preferences
  preferred_notification_channel  notification_channel DEFAULT 'sms',
  notify_sms      BOOLEAN DEFAULT TRUE,
  notify_email    BOOLEAN DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  UNIQUE (email),
  UNIQUE (google_sub)
);

CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_deleted ON users(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- TABLE: properties
-- A building or estate (one company owns many)
-- ============================================================
CREATE TABLE properties (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  address         TEXT,
  county          TEXT,
  latitude        NUMERIC(10,7),
  longitude       NUMERIC(10,7),
  description     TEXT,
  total_units     SMALLINT,
  is_active       BOOLEAN DEFAULT TRUE,

  -- Property-level payment override (can differ from company default)
  payment_method_override  company_payment_method,
  paybill_override         TEXT,
  till_override            TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_properties_company ON properties(company_id);
CREATE INDEX idx_properties_deleted ON properties(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- TABLE: units
-- Individual rentable spaces within a property
-- ============================================================
CREATE TABLE units (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,  -- denorm for fast RLS
  unit_number     TEXT NOT NULL,   -- e.g. 'A1', '3B', 'Shop 2'
  unit_type       TEXT,            -- 'bedsitter','1br','2br','3br','studio','commercial'
  floor_number    SMALLINT,
  size_sqm        NUMERIC(8,2),
  bedrooms        SMALLINT,
  bathrooms       SMALLINT,
  is_occupied     BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  UNIQUE (property_id, unit_number)
);

CREATE INDEX idx_units_property ON units(property_id);
CREATE INDEX idx_units_company ON units(company_id);
CREATE INDEX idx_units_occupied ON units(is_occupied);
CREATE INDEX idx_units_deleted ON units(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- TABLE: tenants
-- Person/entity renting one or more units
-- Separate from users — a tenant may not have portal access
-- ============================================================
CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL if no portal access yet
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT NOT NULL,
  phone_mpesa     TEXT,            -- pre-fill for STK push (not auto-push) (SIM-I2)
  national_id     TEXT,
  kra_pin         TEXT,
  company_name    TEXT,            -- if corporate tenant
  is_corporate    BOOLEAN DEFAULT FALSE,
  emergency_contact_name   TEXT,
  emergency_contact_phone  TEXT,
  notes           TEXT,

  -- Notification preferences (SIM-K2: at least one channel required)
  notify_sms      BOOLEAN DEFAULT TRUE,
  notify_email    BOOLEAN DEFAULT FALSE,
  notification_mode TEXT DEFAULT 'per_unit' CHECK (notification_mode IN ('per_unit','consolidated')),  -- (SIM-K3)

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_tenants_company ON tenants(company_id);
CREATE INDEX idx_tenants_user ON tenants(user_id);
CREATE INDEX idx_tenants_phone ON tenants(phone);
CREATE INDEX idx_tenants_deleted ON tenants(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- TABLE: leases
-- The contract between company and tenant(s) for a unit
-- ============================================================
CREATE TABLE leases (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id         UUID NOT NULL REFERENCES units(id),
  primary_tenant_id UUID NOT NULL REFERENCES tenants(id),

  -- Lease terms
  status          lease_status NOT NULL DEFAULT 'draft',
  start_date      DATE NOT NULL,
  end_date        DATE,            -- NULL = periodic/rolling
  monthly_rent    NUMERIC(12,2) NOT NULL,
  deposit_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_paid_at DATE,
  deposit_paid_amount NUMERIC(12,2) DEFAULT 0,
  notice_period_days SMALLINT DEFAULT 30,

  -- First bill (Decision 2: collected at signing)
  -- Prorated first month is generated at lease creation, due at signing
  -- NOT by the billing cron
  first_bill_generated  BOOLEAN DEFAULT FALSE,  -- set TRUE after signing bill created
  first_bill_id         UUID,  -- FK added after monthly_bills table created

  -- Proration snapshots (SIM-J1, SIM-M5: NEVER live-lookup from company settings)
  -- Set at lease creation from company settings, immutable after activation
  snap_move_in_proration_mode     proration_mode,
  snap_move_in_proration_cutoff   SMALLINT,
  snap_move_in_proration_method   proration_method,
  snap_move_out_proration_mode    move_out_proration_mode,
  snap_bill_first_partial_month   BOOLEAN,
  snap_min_proration_threshold    INTEGER,

  -- Payment method snapshot (SIM-H2: snapshot at lease creation)
  snap_payment_method   company_payment_method,
  snap_paybill_number   TEXT,
  snap_account_reference TEXT,   -- the tenant's unique reference e.g. 'A1-{lease_id_short}'

  -- Employee benefit flag (SIM-T1: caretaker accommodation)
  is_employee_benefit   BOOLEAN DEFAULT FALSE,
  employee_id           UUID,  -- FK to employees table (Phase 2)

  -- Vacate tracking
  vacate_notice_date    DATE,    -- when notice was served
  stated_move_out_date  DATE,    -- what tenant said
  actual_move_out_date  DATE,    -- confirmed by manager at inspection

  -- Audit
  created_by      UUID REFERENCES users(id),
  activated_at    TIMESTAMPTZ,
  terminated_at   TIMESTAMPTZ,
  termination_reason TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leases_company ON leases(company_id);
CREATE INDEX idx_leases_unit ON leases(unit_id);
CREATE INDEX idx_leases_primary_tenant ON leases(primary_tenant_id);
CREATE INDEX idx_leases_status ON leases(status);
CREATE INDEX idx_leases_start_date ON leases(start_date);

-- ============================================================
-- TABLE: lease_tenants (Decision 5: join table)
-- Supports joint tenancy — multiple tenants per lease
-- ============================================================
CREATE TABLE lease_tenants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lease_id        UUID NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,  -- denorm for RLS
  role            TEXT NOT NULL DEFAULT 'co_tenant' CHECK (role IN ('primary','co_tenant','guarantor')),
  is_billing_contact BOOLEAN DEFAULT FALSE,
  added_at        DATE NOT NULL DEFAULT CURRENT_DATE,
  removed_at      DATE,

  UNIQUE (lease_id, tenant_id)
);

CREATE INDEX idx_lease_tenants_lease ON lease_tenants(lease_id);
CREATE INDEX idx_lease_tenants_tenant ON lease_tenants(tenant_id);
CREATE INDEX idx_lease_tenants_company ON lease_tenants(company_id);

-- ============================================================
-- TABLE: monthly_bills
-- One row per lease per billing month
-- ============================================================
CREATE TABLE monthly_bills (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lease_id        UUID NOT NULL REFERENCES leases(id),
  unit_id         UUID NOT NULL REFERENCES units(id),  -- denorm for fast queries

  -- Billing period
  for_month       DATE NOT NULL,  -- always 1st of month e.g. 2026-03-01
  due_date        DATE NOT NULL,
  bill_type       TEXT NOT NULL DEFAULT 'rent' CHECK (bill_type IN ('rent','signing','utility','penalty','adjustment')),

  -- Amounts
  rent_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  utility_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  penalty_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  adjustment_amount NUMERIC(12,2) NOT NULL DEFAULT 0,  -- positive=credit, negative=charge
  total_amount    NUMERIC(12,2) GENERATED ALWAYS AS (
                    rent_amount + utility_amount + penalty_amount + adjustment_amount
                  ) STORED,
  total_paid      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_due       NUMERIC(12,2) GENERATED ALWAYS AS (
                    rent_amount + utility_amount + penalty_amount + adjustment_amount - total_paid
                  ) STORED,

  -- Proration detail (SIM-J4: always show formula)
  is_prorated     BOOLEAN DEFAULT FALSE,
  proration_days  SMALLINT,
  proration_days_in_month SMALLINT,
  proration_method proration_method,
  proration_description TEXT,  -- e.g. '17 days × KES 1,935/day = KES 32,903'

  -- Status
  status          bill_status NOT NULL DEFAULT 'draft',

  -- Payment method snapshot (SIM-H2: never live-lookup)
  snap_payment_method   company_payment_method NOT NULL,
  snap_paybill_number   TEXT,
  snap_account_reference TEXT,

  -- STK lock (SIM-I3: bill locked during in-flight STK)
  stk_lock_until  TIMESTAMPTZ,

  -- Audit
  generated_by    TEXT NOT NULL DEFAULT 'cron' CHECK (generated_by IN ('cron','manual','system')),
  created_by      UUID REFERENCES users(id),
  published_at    TIMESTAMPTZ,
  waived_by       UUID REFERENCES users(id),
  waived_at       TIMESTAMPTZ,
  waive_reason    TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Rec 1: prevents double billing (SIM-A series)
  UNIQUE (lease_id, for_month, bill_type)
);

CREATE INDEX idx_bills_company ON monthly_bills(company_id);
CREATE INDEX idx_bills_lease ON monthly_bills(lease_id);
CREATE INDEX idx_bills_unit ON monthly_bills(unit_id);
CREATE INDEX idx_bills_status ON monthly_bills(status);
CREATE INDEX idx_bills_for_month ON monthly_bills(for_month);
CREATE INDEX idx_bills_due_date ON monthly_bills(due_date);
CREATE INDEX idx_bills_status_due ON monthly_bills(status, due_date) WHERE status IN ('open','partial','overdue');

-- Now we can add the FK from leases to monthly_bills
ALTER TABLE leases ADD CONSTRAINT fk_leases_first_bill
  FOREIGN KEY (first_bill_id) REFERENCES monthly_bills(id);

-- ============================================================
-- TABLE: pending_bill_items
-- Holds charge edits while bill is STK-locked (SIM-N5)
-- Applied automatically after lock releases
-- ============================================================
CREATE TABLE pending_bill_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id         UUID NOT NULL REFERENCES monthly_bills(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_type       TEXT NOT NULL,   -- 'utility','adjustment','penalty'
  amount          NUMERIC(12,2) NOT NULL,
  description     TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at      TIMESTAMPTZ,     -- NULL = not yet applied
  apply_status    TEXT DEFAULT 'pending' CHECK (apply_status IN ('pending','applied','discarded'))
);

CREATE INDEX idx_pending_items_bill ON pending_bill_items(bill_id);
CREATE INDEX idx_pending_items_pending ON pending_bill_items(apply_status) WHERE apply_status = 'pending';

-- ============================================================
-- TABLE: payments
-- Every money-in event against a bill
-- ============================================================
CREATE TABLE payments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bill_id               UUID NOT NULL REFERENCES monthly_bills(id),
  lease_id              UUID NOT NULL REFERENCES leases(id),  -- denorm

  -- Amount
  amount                NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  channel               payment_channel NOT NULL,

  -- M-Pesa fields
  mpesa_receipt_number  TEXT,         -- from Daraja callback
  mpesa_phone           TEXT,
  mpesa_transaction_date TIMESTAMPTZ,

  -- Bank / CSV fields
  bank_transaction_ref  TEXT,         -- REQUIRED for bank payments (SIM-L1)
  bank_name             TEXT,
  bank_transaction_date DATE,
  csv_import_batch_id   UUID,         -- which CSV import this came from

  -- Manual recording
  recorded_by           UUID REFERENCES users(id),
  recorded_at           TIMESTAMPTZ,
  receipt_number        TEXT,         -- internal receipt

  -- Undo window (SIM-H5: 15 min undo)
  undo_expires_at       TIMESTAMPTZ,  -- NOW() + 15 min at creation
  undone_at             TIMESTAMPTZ,
  undone_by             UUID REFERENCES users(id),

  -- Approval (for large amounts or config-driven threshold)
  requires_approval     BOOLEAN DEFAULT FALSE,
  approved_by           UUID REFERENCES users(id),
  approved_at           TIMESTAMPTZ,

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Rec 2: no duplicate Daraja receipts
  UNIQUE (mpesa_receipt_number),
  -- Rec 3: no duplicate bank transaction refs per company
  UNIQUE (company_id, bank_transaction_ref)
);

CREATE INDEX idx_payments_company ON payments(company_id);
CREATE INDEX idx_payments_bill ON payments(bill_id);
CREATE INDEX idx_payments_lease ON payments(lease_id);
CREATE INDEX idx_payments_channel ON payments(channel);
CREATE INDEX idx_payments_mpesa_receipt ON payments(mpesa_receipt_number) WHERE mpesa_receipt_number IS NOT NULL;
CREATE INDEX idx_payments_bank_ref ON payments(bank_transaction_ref) WHERE bank_transaction_ref IS NOT NULL;
CREATE INDEX idx_payments_created ON payments(created_at DESC);

-- ============================================================
-- TABLE: stk_payments
-- One row per STK push attempt (SIM-I1: state machine)
-- ============================================================
CREATE TABLE stk_payments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bill_id               UUID NOT NULL REFERENCES monthly_bills(id),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),

  -- Daraja fields
  checkout_request_id   TEXT NOT NULL,   -- Daraja idempotency key
  merchant_request_id   TEXT,
  phone_number          TEXT NOT NULL,
  amount                NUMERIC(12,2) NOT NULL,

  -- State machine: pending → confirmed | failed | expired | cancelled
  status                stk_status NOT NULL DEFAULT 'pending',
  daraja_result_code    TEXT,
  daraja_result_desc    TEXT,
  mpesa_receipt_number  TEXT,           -- on success

  -- Timing
  pushed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 seconds',
  resolved_at           TIMESTAMPTZ,

  -- Linked payment (set on success)
  payment_id            UUID REFERENCES payments(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (checkout_request_id)
);

CREATE INDEX idx_stk_bill ON stk_payments(bill_id);
CREATE INDEX idx_stk_status ON stk_payments(status) WHERE status = 'pending';
CREATE INDEX idx_stk_expires ON stk_payments(expires_at) WHERE status = 'pending';

-- ============================================================
-- TABLE: unmatched_payments
-- Bank credits with no matching lease reference (SIM-H4, SIM-P8)
-- ============================================================
CREATE TABLE unmatched_payments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Source
  source                TEXT NOT NULL CHECK (source IN ('csv_import','manual_entry')),
  csv_import_batch_id   UUID,

  -- Raw payment data
  amount                NUMERIC(12,2) NOT NULL,
  payer_name            TEXT,
  payer_reference       TEXT,          -- what they entered as account reference
  payer_phone           TEXT,
  transaction_ref       TEXT,
  transaction_date      DATE,
  bank_name             TEXT,
  raw_row_json          JSONB,         -- original CSV row preserved

  -- Fuzzy match suggestions (SIM-P5)
  suggested_lease_id    UUID REFERENCES leases(id),
  suggested_tenant_id   UUID REFERENCES tenants(id),
  suggestion_confidence NUMERIC(5,2),  -- 0–100 score

  -- Resolution
  resolution            unmatched_payment_resolution NOT NULL DEFAULT 'pending',
  resolved_by           UUID REFERENCES users(id),
  resolved_at           TIMESTAMPTZ,
  resolved_payment_id   UUID REFERENCES payments(id),  -- if assigned
  resolution_notes      TEXT,

  -- Write-off approval (period close blocks on unresolved, SIM-L4)
  writeoff_approved_by  UUID REFERENCES users(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_unmatched_company ON unmatched_payments(company_id);
CREATE INDEX idx_unmatched_resolution ON unmatched_payments(resolution) WHERE resolution = 'pending';
-- GIN index for fuzzy name matching (SIM-P5, pg_trgm)
CREATE INDEX idx_unmatched_payer_trgm ON unmatched_payments USING GIN (payer_name gin_trgm_ops);
CREATE INDEX idx_unmatched_payer_ref_trgm ON unmatched_payments USING GIN (payer_reference gin_trgm_ops);

-- ============================================================
-- TABLE: csv_import_batches
-- Tracks every CSV upload (SIM-P3: duplicate file detection)
-- ============================================================
CREATE TABLE csv_import_batches (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_name         TEXT NOT NULL,
  filename          TEXT NOT NULL,
  file_hash         TEXT NOT NULL,      -- SHA-256 of file content
  column_mapping    JSONB,              -- saved column map for this bank template
  template_name     TEXT,              -- e.g. 'Equity Standard Export'

  -- Stats
  total_rows        INTEGER DEFAULT 0,
  matched_rows      INTEGER DEFAULT 0,
  unmatched_rows    INTEGER DEFAULT 0,
  duplicate_rows    INTEGER DEFAULT 0,  -- already recorded rows skipped

  status            TEXT NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing','completed','failed','partial')),
  error_message     TEXT,

  imported_by       UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,

  -- Rec 56: duplicate CSV file blocked
  UNIQUE (company_id, file_hash)
);

CREATE INDEX idx_csv_batches_company ON csv_import_batches(company_id);
CREATE INDEX idx_csv_batches_created ON csv_import_batches(created_at DESC);

-- ============================================================
-- TABLE: csv_bank_templates
-- Saved column mappings per bank per company (SIM-L2)
-- ============================================================
CREATE TABLE csv_bank_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_name       TEXT NOT NULL,
  template_name   TEXT NOT NULL,
  is_default      BOOLEAN DEFAULT FALSE,

  -- Column mapping: PropManager field → CSV column name/index
  col_transaction_ref   TEXT,
  col_transaction_date  TEXT,
  col_amount            TEXT,
  col_payer_name        TEXT,
  col_payer_reference   TEXT,   -- account reference tenant enters
  col_payer_phone       TEXT,
  col_narration         TEXT,
  col_balance           TEXT,

  -- Date format hint
  date_format     TEXT DEFAULT 'DD/MM/YYYY',

  -- Skip rows config
  header_rows_to_skip  SMALLINT DEFAULT 1,

  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (company_id, bank_name, template_name)
);

CREATE INDEX idx_csv_templates_company ON csv_bank_templates(company_id);

-- ============================================================
-- TABLE: notifications
-- Every outbound reminder/alert queued (SIM-K1, SIM-O2)
-- ============================================================
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tenant_id       UUID REFERENCES tenants(id),
  user_id         UUID REFERENCES users(id),   -- for staff alerts
  bill_id         UUID REFERENCES monthly_bills(id),

  channel         notification_channel NOT NULL,
  recipient       TEXT NOT NULL,   -- phone number or email
  subject         TEXT,
  body            TEXT NOT NULL,
  status          notification_status NOT NULL DEFAULT 'queued',

  -- Retry tracking (SIM-O2: 3 retries, 5 min apart)
  attempt_count   SMALLINT DEFAULT 0,
  max_attempts    SMALLINT DEFAULT 3,
  next_attempt_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,

  -- Delivery tracking (SIM-I2: track delivered_at not just sent_at)
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,         -- from AT delivery receipt webhook
  is_stale        BOOLEAN DEFAULT FALSE, -- delivered >24h after send (SIM-I2)

  -- AT reference
  at_message_id   TEXT,
  at_status_code  TEXT,
  at_error        TEXT,

  -- Cancellation (SIM-K1: payment cancels pending reminders)
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_company ON notifications(company_id);
CREATE INDEX idx_notifications_bill ON notifications(bill_id);
CREATE INDEX idx_notifications_status ON notifications(status) WHERE status IN ('queued','failed');
CREATE INDEX idx_notifications_next_attempt ON notifications(next_attempt_at)
  WHERE status IN ('queued','failed') AND next_attempt_at IS NOT NULL;
CREATE INDEX idx_notifications_tenant ON notifications(tenant_id);

-- ============================================================
-- TABLE: maintenance_requests
-- Reported issues on units
-- ============================================================
CREATE TABLE maintenance_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id     UUID NOT NULL REFERENCES properties(id),
  unit_id         UUID REFERENCES units(id),
  reported_by     UUID REFERENCES users(id),   -- tenant or caretaker
  assigned_to     UUID REFERENCES users(id),   -- caretaker

  title           TEXT NOT NULL,
  description     TEXT,
  priority        maintenance_priority NOT NULL DEFAULT 'medium',
  status          maintenance_status NOT NULL DEFAULT 'open',
  category        TEXT,   -- 'plumbing','electrical','structural','cleaning',etc.

  reported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  resolution_notes TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_maintenance_company ON maintenance_requests(company_id);
CREATE INDEX idx_maintenance_property ON maintenance_requests(property_id);
CREATE INDEX idx_maintenance_unit ON maintenance_requests(unit_id);
CREATE INDEX idx_maintenance_status ON maintenance_requests(status) WHERE status != 'closed';
CREATE INDEX idx_maintenance_assigned ON maintenance_requests(assigned_to);

-- ============================================================
-- TABLE: expenses
-- Company operating expenses (per property/unit)
-- ============================================================
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id     UUID REFERENCES properties(id),
  unit_id         UUID REFERENCES units(id),   -- NULL = whole-property expense
  maintenance_id  UUID REFERENCES maintenance_requests(id),

  category        TEXT NOT NULL,   -- 'maintenance','utilities','staff','insurance',etc.
  description     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  expense_date    DATE NOT NULL,
  paid_by         TEXT,            -- who paid (petty cash, bank, etc.)
  receipt_url     TEXT,
  vendor_name     TEXT,

  -- Tenant-chargeable flag
  is_tenant_chargeable  BOOLEAN DEFAULT FALSE,
  charged_to_bill_id    UUID REFERENCES monthly_bills(id),

  recorded_by     UUID REFERENCES users(id),
  approved_by     UUID REFERENCES users(id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_company ON expenses(company_id);
CREATE INDEX idx_expenses_property ON expenses(property_id);
CREATE INDEX idx_expenses_date ON expenses(expense_date DESC);

-- ============================================================
-- TABLE: financial_periods
-- Controls period open/close for reconciliation (SIM-L4)
-- ============================================================
CREATE TABLE financial_periods (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_month    DATE NOT NULL,  -- always 1st of month
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','closing','closed','locked')),

  -- Close pre-checks
  unmatched_payment_count  INTEGER DEFAULT 0,
  unreconciled_bill_count  INTEGER DEFAULT 0,
  close_blocked_reason     TEXT,

  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  closed_by       UUID REFERENCES users(id),
  locked_at       TIMESTAMPTZ,
  locked_by       UUID REFERENCES users(id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (company_id, period_month)
);

CREATE INDEX idx_periods_company ON financial_periods(company_id);
CREATE INDEX idx_periods_status ON financial_periods(status) WHERE status = 'open';
