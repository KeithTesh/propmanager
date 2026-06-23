-- ============================================================
-- PROPMANAGER — PHASE 1 DATABASE SCHEMA
-- Migration 002: Audit, RLS, Cron Tracking, Triggers
-- ============================================================

-- ============================================================
-- TABLE: audit_logs (PARTITIONED by month)
-- Rec 12: partition at schema creation — never retrofit
-- All financial mutations logged here
-- ============================================================
CREATE TABLE audit_logs (
  id              UUID NOT NULL DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  table_name      TEXT NOT NULL,
  record_id       UUID NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','SOFT_DELETE')),
  actor_id        UUID,            -- user who made the change (NULL = system/cron)
  actor_role      user_role,
  old_values      JSONB,
  new_values      JSONB,
  changed_fields  TEXT[],          -- list of column names that changed
  ip_address      INET,
  user_agent      TEXT,
  session_id      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create initial partitions (extend monthly via cron)
CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit_logs_2026_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_logs_2026_07 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_logs_2026_08 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_logs_2027_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE audit_logs_2027_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE audit_logs_2027_03 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');

-- Indexes on partition key + common queries
CREATE INDEX idx_audit_company_time ON audit_logs(company_id, created_at DESC);
CREATE INDEX idx_audit_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id) WHERE actor_id IS NOT NULL;

-- ============================================================
-- TABLE: cron_job_runs
-- Tracks every cron execution for idempotency & debugging
-- Rec 40: all cron jobs idempotent and logged
-- ============================================================
CREATE TABLE cron_job_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name        TEXT NOT NULL,     -- 'bill_generation','penalty','stk_reconciliation','reminder'
  for_month       DATE,              -- for month-based crons
  company_id      UUID REFERENCES companies(id),  -- NULL = runs across all companies
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','completed','failed','skipped')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  records_processed INTEGER DEFAULT 0,
  records_skipped   INTEGER DEFAULT 0,
  records_failed    INTEGER DEFAULT 0,
  error_message   TEXT,
  lock_key        TEXT,              -- Redis lock key used

  -- Idempotency: if same job+month already completed, skip
  UNIQUE (job_name, for_month, company_id)
);

CREATE INDEX idx_cron_job_name ON cron_job_runs(job_name, started_at DESC);
CREATE INDEX idx_cron_status ON cron_job_runs(status) WHERE status = 'running';

-- ============================================================
-- TRIGGERS: updated_at auto-maintenance
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER trg_companies_updated
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_properties_updated
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_units_updated
  BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenants_updated
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_leases_updated
  BEFORE UPDATE ON leases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bills_updated
  BEFORE UPDATE ON monthly_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payments_updated
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_unmatched_updated
  BEFORE UPDATE ON unmatched_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_maintenance_updated
  BEFORE UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_expenses_updated
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_csv_templates_updated
  BEFORE UPDATE ON csv_bank_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TRIGGER: enforce at least one notification channel per tenant
-- Rec 35: system enforces minimum one active channel (SIM-K2)
-- ============================================================
CREATE OR REPLACE FUNCTION check_tenant_notification_channel()
RETURNS TRIGGER AS $$
BEGIN
  -- If both channels being disabled, block the update
  IF NOT NEW.notify_sms AND NOT NEW.notify_email THEN
    RAISE EXCEPTION
      'Tenant must have at least one active notification channel. '
      'Add an email address before disabling SMS.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenant_notification_channel
  BEFORE UPDATE OF notify_sms, notify_email ON tenants
  FOR EACH ROW EXECUTE FUNCTION check_tenant_notification_channel();

-- ============================================================
-- TRIGGER: bill total_paid atomic update guard
-- Rec 20: prevent read-modify-write races on total_paid
-- Direct UPDATE SET total_paid = total_paid + amount only
-- ============================================================
CREATE OR REPLACE FUNCTION validate_bill_payment_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent total_paid from going negative
  IF NEW.total_paid < 0 THEN
    RAISE EXCEPTION 'Bill total_paid cannot be negative'
      USING ERRCODE = 'P0002';
  END IF;
  -- Prevent editing amount fields while STK is in-flight (SIM-I3)
  IF OLD.stk_lock_until IS NOT NULL
     AND OLD.stk_lock_until > NOW()
     AND (NEW.rent_amount != OLD.rent_amount
       OR NEW.utility_amount != OLD.utility_amount
       OR NEW.penalty_amount != OLD.penalty_amount)
  THEN
    RAISE EXCEPTION 'Bill is locked during active STK payment. Try again after %',
      OLD.stk_lock_until
      USING ERRCODE = 'P0003';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bill_payment_guard
  BEFORE UPDATE ON monthly_bills
  FOR EACH ROW EXECUTE FUNCTION validate_bill_payment_update();

-- ============================================================
-- TRIGGER: self-approval block on payments
-- Rec 51 pattern: recorded_by ≠ approved_by
-- ============================================================
CREATE OR REPLACE FUNCTION block_payment_self_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.approved_by IS NOT NULL
     AND NEW.recorded_by IS NOT NULL
     AND NEW.approved_by = NEW.recorded_by THEN
    RAISE EXCEPTION 'Self-approval is not permitted. A different user must approve this payment.'
      USING ERRCODE = 'P0004';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_self_approval
  BEFORE INSERT OR UPDATE OF approved_by ON payments
  FOR EACH ROW EXECUTE FUNCTION block_payment_self_approval();

-- ============================================================
-- TRIGGER: unit occupancy auto-update
-- When a lease becomes active → mark unit occupied
-- When a lease terminates/expires → mark unit vacant
-- ============================================================
CREATE OR REPLACE FUNCTION sync_unit_occupancy()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    UPDATE units SET is_occupied = TRUE WHERE id = NEW.unit_id;
  ELSIF NEW.status IN ('terminated','expired') AND OLD.status NOT IN ('terminated','expired') THEN
    -- Only mark vacant if no other active lease on same unit
    IF NOT EXISTS (
      SELECT 1 FROM leases
      WHERE unit_id = NEW.unit_id
        AND id != NEW.id
        AND status = 'active'
    ) THEN
      UPDATE units SET is_occupied = FALSE WHERE id = NEW.unit_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_unit_occupancy
  AFTER UPDATE OF status ON leases
  FOR EACH ROW EXECUTE FUNCTION sync_unit_occupancy();

-- ============================================================
-- ROW-LEVEL SECURITY (RLS)
-- Rec 41-pattern: company_id isolation from day one
-- All financial tables enforce company_id = current_company_id
-- ============================================================

-- Enable RLS on all multi-tenant tables
ALTER TABLE companies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_setup_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties             ENABLE ROW LEVEL SECURITY;
ALTER TABLE units                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants                ENABLE ROW LEVEL SECURITY;
ALTER TABLE leases                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_bills          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_bill_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE stk_payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE unmatched_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_import_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_bank_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_periods      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs             ENABLE ROW LEVEL SECURITY;

-- The app sets this at connection time:
-- SET app.current_company_id = '<uuid>';
-- SET app.current_user_id = '<uuid>';
-- SET app.current_user_role = 'manager';

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION current_company_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_company_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.current_user_role', TRUE), '');
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION is_super_admin() RETURNS BOOLEAN AS $$
  SELECT current_user_role() = 'super_admin';
$$ LANGUAGE SQL STABLE;

-- ── COMPANIES ────────────────────────────────────────────────
-- Super admin sees all; company users see only their own
CREATE POLICY companies_isolation ON companies
  USING (is_super_admin() OR id = current_company_id());

-- ── COMPANY_SETUP_PROGRESS ───────────────────────────────────
CREATE POLICY setup_progress_isolation ON company_setup_progress
  USING (is_super_admin() OR company_id = current_company_id());

-- ── USERS ────────────────────────────────────────────────────
-- Company staff see only their company's users
-- Tenants see only themselves
CREATE POLICY users_isolation ON users
  USING (
    is_super_admin()
    OR company_id = current_company_id()
    OR id = current_user_id()
  );

-- ── PROPERTIES ───────────────────────────────────────────────
CREATE POLICY properties_isolation ON properties
  USING (is_super_admin() OR company_id = current_company_id());

-- ── UNITS ────────────────────────────────────────────────────
CREATE POLICY units_isolation ON units
  USING (is_super_admin() OR company_id = current_company_id());

-- ── TENANTS ──────────────────────────────────────────────────
CREATE POLICY tenants_isolation ON tenants
  USING (is_super_admin() OR company_id = current_company_id());

-- ── LEASES ───────────────────────────────────────────────────
CREATE POLICY leases_isolation ON leases
  USING (is_super_admin() OR company_id = current_company_id());

-- ── LEASE_TENANTS ─────────────────────────────────────────────
CREATE POLICY lease_tenants_isolation ON lease_tenants
  USING (is_super_admin() OR company_id = current_company_id());

-- ── MONTHLY_BILLS ────────────────────────────────────────────
CREATE POLICY bills_isolation ON monthly_bills
  USING (is_super_admin() OR company_id = current_company_id());

-- ── PENDING_BILL_ITEMS ───────────────────────────────────────
CREATE POLICY pending_items_isolation ON pending_bill_items
  USING (is_super_admin() OR company_id = current_company_id());

-- ── PAYMENTS ─────────────────────────────────────────────────
CREATE POLICY payments_isolation ON payments
  USING (is_super_admin() OR company_id = current_company_id());

-- ── STK_PAYMENTS ─────────────────────────────────────────────
CREATE POLICY stk_isolation ON stk_payments
  USING (is_super_admin() OR company_id = current_company_id());

-- ── UNMATCHED_PAYMENTS ───────────────────────────────────────
CREATE POLICY unmatched_isolation ON unmatched_payments
  USING (is_super_admin() OR company_id = current_company_id());

-- ── CSV_IMPORT_BATCHES ───────────────────────────────────────
CREATE POLICY csv_batches_isolation ON csv_import_batches
  USING (is_super_admin() OR company_id = current_company_id());

-- ── CSV_BANK_TEMPLATES ───────────────────────────────────────
CREATE POLICY csv_templates_isolation ON csv_bank_templates
  USING (is_super_admin() OR company_id = current_company_id());

-- ── NOTIFICATIONS ────────────────────────────────────────────
CREATE POLICY notifications_isolation ON notifications
  USING (is_super_admin() OR company_id = current_company_id());

-- ── MAINTENANCE_REQUESTS ─────────────────────────────────────
CREATE POLICY maintenance_isolation ON maintenance_requests
  USING (is_super_admin() OR company_id = current_company_id());

-- ── EXPENSES ─────────────────────────────────────────────────
CREATE POLICY expenses_isolation ON expenses
  USING (is_super_admin() OR company_id = current_company_id());

-- ── FINANCIAL_PERIODS ────────────────────────────────────────
CREATE POLICY periods_isolation ON financial_periods
  USING (is_super_admin() OR company_id = current_company_id());

-- ── AUDIT_LOGS ───────────────────────────────────────────────
-- Immutable — no INSERT/UPDATE/DELETE policies for non-super-admin
-- App writes via a dedicated audit role that bypasses RLS
CREATE POLICY audit_read_isolation ON audit_logs
  FOR SELECT
  USING (is_super_admin() OR company_id = current_company_id());

-- ============================================================
-- VIEWS: common query patterns
-- ============================================================

-- Active leases with unit and tenant info
CREATE VIEW v_active_leases AS
SELECT
  l.id,
  l.company_id,
  l.unit_id,
  l.primary_tenant_id,
  l.status,
  l.start_date,
  l.end_date,
  l.monthly_rent,
  l.deposit_amount,
  l.snap_payment_method,
  l.snap_paybill_number,
  l.snap_account_reference,
  u.unit_number,
  u.unit_type,
  p.id AS property_id,
  p.name AS property_name,
  t.full_name AS primary_tenant_name,
  t.phone AS primary_tenant_phone,
  t.email AS primary_tenant_email,
  t.phone_mpesa AS primary_tenant_mpesa
FROM leases l
JOIN units u ON u.id = l.unit_id
JOIN properties p ON p.id = u.property_id
JOIN tenants t ON t.id = l.primary_tenant_id
WHERE l.status = 'active';

-- Outstanding bills summary
CREATE VIEW v_outstanding_bills AS
SELECT
  b.id,
  b.company_id,
  b.lease_id,
  b.unit_id,
  b.for_month,
  b.due_date,
  b.total_amount,
  b.total_paid,
  b.total_due,
  b.status,
  b.snap_payment_method,
  b.snap_account_reference,
  b.stk_lock_until,
  u.unit_number,
  p.name AS property_name,
  t.full_name AS tenant_name,
  t.phone AS tenant_phone,
  t.phone_mpesa AS tenant_mpesa,
  CURRENT_DATE - b.due_date AS days_overdue
FROM monthly_bills b
JOIN leases l ON l.id = b.lease_id
JOIN units u ON u.id = b.unit_id
JOIN properties p ON p.id = u.property_id
JOIN tenants t ON t.id = l.primary_tenant_id
WHERE b.status IN ('open', 'partial', 'overdue', 'payment_received_pending_verification');

-- Company dashboard summary (avoids N+1 queries)
CREATE VIEW v_company_dashboard AS
SELECT
  c.id AS company_id,
  c.name AS company_name,
  COUNT(DISTINCT p.id) AS total_properties,
  COUNT(DISTINCT u.id) AS total_units,
  COUNT(DISTINCT u.id) FILTER (WHERE u.is_occupied) AS occupied_units,
  COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'active') AS active_leases,
  COALESCE(SUM(b.total_due) FILTER (WHERE b.status IN ('open','partial','overdue')), 0) AS total_outstanding,
  COALESCE(SUM(b.total_paid) FILTER (
    WHERE b.for_month = DATE_TRUNC('month', CURRENT_DATE)
  ), 0) AS collected_this_month,
  COALESCE(SUM(b.total_amount) FILTER (
    WHERE b.for_month = DATE_TRUNC('month', CURRENT_DATE)
  ), 0) AS expected_this_month,
  COUNT(un.id) FILTER (WHERE un.resolution = 'pending') AS unmatched_payments_pending
FROM companies c
LEFT JOIN properties p ON p.company_id = c.id AND p.deleted_at IS NULL
LEFT JOIN units u ON u.company_id = c.id AND u.deleted_at IS NULL
LEFT JOIN leases l ON l.company_id = c.id
LEFT JOIN monthly_bills b ON b.company_id = c.id
LEFT JOIN unmatched_payments un ON un.company_id = c.id
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.name;
