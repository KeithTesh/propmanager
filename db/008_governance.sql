-- =====================================================================
-- 008_governance.sql  –  Phase 2: Financial Governance
-- =====================================================================
-- 1. Expense approval workflow  (status: pending → approved | rejected)
-- 2. Payment reversal governance  (reversal_reason, reversed_by, reversed_at)
-- 3. financial_periods enhancements (pre-close checks, force-close notes)
-- =====================================================================

-- ─── 1. EXPENSE APPROVAL STATUS ──────────────────────────────────────
-- expenses.approved_by + expenses.approved_at already exist in 001_core.sql
-- We add approval_status + rejection support

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS approval_status  TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approval_notes   TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by      UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by     UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ;

-- Backfill existing rows: anything already in the table is implicitly approved
UPDATE expenses SET approval_status = 'approved' WHERE approval_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_approval ON expenses(company_id, approval_status)
  WHERE approval_status = 'pending';

-- ─── 2. PAYMENT REVERSAL GOVERNANCE ──────────────────────────────────
-- payments already has undo_expires_at / undone_at / undone_by (15-min undo)
-- We add a separate formal reversal path for post-undo-window corrections

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS is_reversed       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reversal_reason   TEXT,
  ADD COLUMN IF NOT EXISTS reversed_by       UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_ref_id   UUID REFERENCES payments(id);
  -- reversal_ref_id links the reversal entry back to the original payment

CREATE INDEX IF NOT EXISTS idx_payments_reversed ON payments(company_id, is_reversed)
  WHERE is_reversed = TRUE;

-- ─── 3. FINANCIAL PERIODS ENHANCEMENTS ───────────────────────────────
-- financial_periods already exists; add force-close and notes columns

ALTER TABLE financial_periods
  ADD COLUMN IF NOT EXISTS force_closed       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS force_close_notes  TEXT,
  ADD COLUMN IF NOT EXISTS locked_reason      TEXT;

-- ─── 4. EXPENSE APPROVAL THRESHOLD CONFIG ────────────────────────────
-- Add per-company approval threshold to companies table
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS expense_approval_threshold NUMERIC(12,2) DEFAULT NULL;
  -- NULL means no auto-approval workflow; a value e.g. 5000 means
  -- expenses >= that amount are created in 'pending' status

-- ─── 5. AUDIT TRIGGER for governance actions ─────────────────────────
-- Reuse existing write_audit_log() function from 002_audit_rls_triggers.sql

CREATE OR REPLACE FUNCTION audit_expense_approval()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approval_status IS DISTINCT FROM NEW.approval_status THEN
    PERFORM write_audit_log(
      NEW.company_id,
      CASE WHEN NEW.approval_status = 'approved' THEN NEW.approved_by
           WHEN NEW.approval_status = 'rejected' THEN NEW.rejected_by
           ELSE NULL END,
      'expense',
      NEW.id,
      'update',
      jsonb_build_object('approval_status', OLD.approval_status, 'amount', OLD.amount, 'description', OLD.description),
      jsonb_build_object('approval_status', NEW.approval_status, 'approval_notes', NEW.approval_notes)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_expense_approval ON expenses;
CREATE TRIGGER trg_audit_expense_approval
  AFTER UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION audit_expense_approval();

CREATE OR REPLACE FUNCTION audit_payment_reversal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_reversed = TRUE AND (OLD.is_reversed = FALSE OR OLD.is_reversed IS NULL) THEN
    PERFORM write_audit_log(
      NEW.company_id,
      NEW.reversed_by,
      'payment',
      NEW.id,
      'reversal',
      jsonb_build_object('amount', OLD.amount, 'channel', OLD.channel),
      jsonb_build_object('reversal_reason', NEW.reversal_reason, 'reversed_at', NEW.reversed_at)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_payment_reversal ON payments;
CREATE TRIGGER trg_audit_payment_reversal
  AFTER UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_payment_reversal();