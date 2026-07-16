-- ============================================================
-- Workshop contact info: public-facing email and website,
-- shown on invoices alongside phone/address.
-- ============================================================

ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS email   TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;
