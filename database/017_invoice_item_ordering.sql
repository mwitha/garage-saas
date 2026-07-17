-- ============================================================
-- Invoice item ordering
-- invoice_items.id is a random UUID, so "ORDER BY id" (the prior
-- behaviour) displayed items in effectively random order rather than
-- insertion order. Adds an explicit, editable sort position.
-- ============================================================

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Backfill: give existing rows a stable order per invoice, using
-- their current (random) id order as the baseline.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY id) - 1 AS rn
  FROM invoice_items
)
UPDATE invoice_items ii
SET sort_order = ordered.rn
FROM ordered
WHERE ii.id = ordered.id;

ALTER TABLE invoice_items
  ALTER COLUMN sort_order SET NOT NULL,
  ALTER COLUMN sort_order SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_invoice_items_order ON invoice_items(invoice_id, sort_order);
