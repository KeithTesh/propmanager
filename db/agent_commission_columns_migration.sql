-- Add default commission columns to companies (for agent accounts)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS default_commission_type  TEXT DEFAULT 'percentage'
    CHECK (default_commission_type IN ('flat','percentage')),
  ADD COLUMN IF NOT EXISTS default_commission_value NUMERIC(10,2) DEFAULT 10;