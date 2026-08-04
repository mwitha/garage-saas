-- Optional "next service due" date shown on an invoice, defaulting to
-- 6 months from the invoice date. Opt-in per invoice, not set by default.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS next_service_date DATE;
