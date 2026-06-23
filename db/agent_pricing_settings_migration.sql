-- Adds agent-plan pricing and a configurable annual discount to platform_settings.
-- Previously only landlord plan prices existed here; agent prices and the
-- annual discount percentage were hardcoded in the marketing site's JS.

INSERT INTO platform_settings (key, value, description) VALUES
  ('agent_starter_price',    '3500',  'Agent Starter plan monthly price in KES'),
  ('agent_growth_price',     '7500',  'Agent Growth plan monthly price in KES'),
  ('agent_enterprise_price', '15000', 'Agent Enterprise plan monthly price in KES'),
  ('annual_discount_percent','20',    'Discount % applied when billed annually (both landlord and agent plans)')
ON CONFLICT (key) DO NOTHING;
