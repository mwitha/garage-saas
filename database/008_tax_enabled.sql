-- Add tax_enabled flag to workshops so workshops can opt out of tax on invoices
ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN NOT NULL DEFAULT true;
