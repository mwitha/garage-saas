-- Optional warranty period for replacement parts, shown on the invoice
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS warranty_months SMALLINT
    CHECK (warranty_months IS NULL OR warranty_months IN (3, 6, 12));
