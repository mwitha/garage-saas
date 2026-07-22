-- Custom payment instructions shown at the bottom of every invoice
-- (e.g. "Cheque should be drawn in favour of X" or bank deposit details).
-- Per-workshop since this is a multi-tenant app.
ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS payment_instructions TEXT;
