-- ============================================================
-- 013_landlords_rls.sql
-- Enable Row Level Security on all tables added by
-- agent_intergration_migration.sql (landlords, commission_overrides,
-- remittance_statements, remittance_statement_lines, remittance_disputes).
-- ============================================================

-- ── landlords ─────────────────────────────────────────────────────────────────
ALTER TABLE landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE landlords FORCE ROW LEVEL SECURITY;

CREATE POLICY landlords_isolation ON landlords
  USING (is_super_admin() OR company_id = current_company_id());

-- ── commission_overrides ──────────────────────────────────────────────────────
ALTER TABLE commission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY commission_overrides_isolation ON commission_overrides
  USING (is_super_admin() OR company_id = current_company_id());

-- ── remittance_statements ─────────────────────────────────────────────────────
ALTER TABLE remittance_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_statements FORCE ROW LEVEL SECURITY;

CREATE POLICY remittance_statements_isolation ON remittance_statements
  USING (is_super_admin() OR company_id = current_company_id());

-- ── remittance_statement_lines ────────────────────────────────────────────────
-- Lines join via statement_id — scope through the parent statement's company.
ALTER TABLE remittance_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_statement_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY remittance_lines_isolation ON remittance_statement_lines
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM remittance_statements rs
      WHERE rs.id         = remittance_statement_lines.statement_id
        AND rs.company_id = current_company_id()
    )
  );

-- ── remittance_disputes ───────────────────────────────────────────────────────
ALTER TABLE remittance_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_disputes FORCE ROW LEVEL SECURITY;

CREATE POLICY remittance_disputes_isolation ON remittance_disputes
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM remittance_statements rs
      WHERE rs.id         = remittance_disputes.statement_id
        AND rs.company_id = current_company_id()
    )
  );
