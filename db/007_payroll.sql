-- =====================================================================
-- 007_payroll.sql  –  Phase 2: Payroll Module
-- =====================================================================

-- Employee types
CREATE TYPE employment_type AS ENUM ('full_time', 'part_time', 'contract', 'casual');
CREATE TYPE payroll_run_status AS ENUM ('draft', 'approved', 'paid', 'cancelled');
CREATE TYPE payment_channel_payroll AS ENUM ('bank_transfer', 'mpesa', 'cash');

-- ─── employees ───────────────────────────────────────────────────────
CREATE TABLE employees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Link to a staff user account if they have one
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Personal details
  full_name         TEXT NOT NULL,
  national_id       TEXT,
  kra_pin           TEXT,
  nssf_number       TEXT,
  shif_number       TEXT,
  phone             TEXT,
  email             TEXT,
  bank_name         TEXT,
  bank_account      TEXT,
  mpesa_number      TEXT,
  preferred_payment_channel payment_channel_payroll NOT NULL DEFAULT 'bank_transfer',
  -- Employment details
  employment_type   employment_type NOT NULL DEFAULT 'full_time',
  job_title         TEXT NOT NULL,
  department        TEXT,
  -- Linked property/unit (for caretakers etc.)
  property_id       UUID REFERENCES properties(id) ON DELETE SET NULL,
  -- Salary
  gross_salary      NUMERIC(12,2) NOT NULL CHECK (gross_salary > 0),
  -- Allowances (non-taxable by default)
  house_allowance   NUMERIC(12,2) NOT NULL DEFAULT 0,
  transport_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_allowances  NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Voluntary deductions
  helb_deduction    NUMERIC(12,2) NOT NULL DEFAULT 0,
  sacco_deduction   NUMERIC(12,2) NOT NULL DEFAULT 0,
  loan_deduction    NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deductions  NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Advance tracking
  advance_balance   NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Status
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  start_date        DATE NOT NULL,
  end_date          DATE,
  notes             TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

-- ─── salary_advances ─────────────────────────────────────────────────
CREATE TABLE salary_advances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason          TEXT,
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  disbursed_at    TIMESTAMPTZ,
  is_disbursed    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Repayment: deducted automatically over N payroll runs
  repayment_months INT NOT NULL DEFAULT 1 CHECK (repayment_months >= 1),
  monthly_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  fully_repaid_at TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── payroll_runs ─────────────────────────────────────────────────────
CREATE TABLE payroll_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_month   DATE NOT NULL,                -- always 1st of month
  status          payroll_run_status NOT NULL DEFAULT 'draft',
  total_gross     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_paye      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_nssf_employee NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_nssf_employer NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_shif      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ahl_employee NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ahl_employer NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_nita      NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  paid_by         UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, payroll_month)
);

-- ─── payroll_items ────────────────────────────────────────────────────
-- One row per employee per payroll run
CREATE TABLE payroll_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id    UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- Snapshot of salary at time of run
  gross_salary      NUMERIC(12,2) NOT NULL,
  house_allowance   NUMERIC(12,2) NOT NULL DEFAULT 0,
  transport_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_allowances  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_gross       NUMERIC(12,2) NOT NULL,   -- gross_salary + allowances
  -- Statutory deductions (employee side)
  nssf_employee     NUMERIC(12,2) NOT NULL DEFAULT 0,
  shif_employee     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ahl_employee      NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable_income    NUMERIC(12,2) NOT NULL,   -- gross - NSSF - AHL
  paye              NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Voluntary deductions
  helb_deduction    NUMERIC(12,2) NOT NULL DEFAULT 0,
  sacco_deduction   NUMERIC(12,2) NOT NULL DEFAULT 0,
  loan_deduction    NUMERIC(12,2) NOT NULL DEFAULT 0,
  advance_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deductions  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions  NUMERIC(12,2) NOT NULL,
  net_pay           NUMERIC(12,2) NOT NULL,
  -- Employer costs
  nssf_employer     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ahl_employer      NUMERIC(12,2) NOT NULL DEFAULT 0,
  nita              NUMERIC(12,2) NOT NULL DEFAULT 50, -- KES 50/employee
  -- Payment tracking
  payment_channel   payment_channel_payroll,
  bank_name         TEXT,
  bank_account      TEXT,
  mpesa_number      TEXT,
  is_paid           BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_run_id, employee_id)
);

-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_advances  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items    ENABLE ROW LEVEL SECURITY;

CREATE POLICY employees_company_isolation ON employees
  USING (company_id = current_setting('app.company_id')::UUID);
CREATE POLICY salary_advances_company_isolation ON salary_advances
  USING (company_id = current_setting('app.company_id')::UUID);
CREATE POLICY payroll_runs_company_isolation ON payroll_runs
  USING (company_id = current_setting('app.company_id')::UUID);
CREATE POLICY payroll_items_company_isolation ON payroll_items
  USING (company_id = current_setting('app.company_id')::UUID);

-- ─── Indexes ─────────────────────────────────────────────────────────
CREATE INDEX idx_employees_company        ON employees(company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employees_user           ON employees(user_id);
CREATE INDEX idx_salary_advances_employee ON salary_advances(employee_id);
CREATE INDEX idx_payroll_runs_company     ON payroll_runs(company_id, payroll_month DESC);
CREATE INDEX idx_payroll_items_run        ON payroll_items(payroll_run_id);
CREATE INDEX idx_payroll_items_employee   ON payroll_items(employee_id);