-- db/004_cron_job_runs.sql
-- Adds cron_job_runs table for billing cron idempotency tracking

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name        TEXT NOT NULL,
  for_month       DATE NOT NULL,
  company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','completed','failed')),
  lock_key        TEXT,
  records_processed INTEGER DEFAULT 0,
  records_skipped   INTEGER DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,

  UNIQUE (job_name, for_month, company_id)
);

CREATE INDEX IF NOT EXISTS idx_cron_job_runs_month   ON cron_job_runs(for_month);
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_company ON cron_job_runs(company_id);