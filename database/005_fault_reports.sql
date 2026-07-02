-- Extend stock_adjustments with supplier/delivery details
ALTER TABLE stock_adjustments
  ADD COLUMN IF NOT EXISTS supplier_name    TEXT,
  ADD COLUMN IF NOT EXISTS supplier_phone   TEXT,
  ADD COLUMN IF NOT EXISTS supplier_invoice TEXT,
  ADD COLUMN IF NOT EXISTS unit_cost        NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS batch_note       TEXT;

-- Link work_order_items to the adjustment that consumed the stock
ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS stock_adjustment_id UUID REFERENCES stock_adjustments(id);

-- Fault reports
CREATE TABLE IF NOT EXISTS part_fault_reports (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id         UUID        NOT NULL REFERENCES workshops(id)       ON DELETE CASCADE,
  work_order_id       UUID        NOT NULL REFERENCES work_orders(id),
  work_order_item_id  UUID        NOT NULL REFERENCES work_order_items(id),
  inventory_item_id   UUID        NOT NULL REFERENCES inventory_items(id),
  stock_adjustment_id UUID                 REFERENCES stock_adjustments(id),
  reported_by         UUID                 REFERENCES users(id),
  fault_description   TEXT        NOT NULL,
  supplier_name       TEXT,
  supplier_phone      TEXT,
  supplier_invoice    TEXT,
  status              TEXT        NOT NULL DEFAULT 'open',
  resolution_note     TEXT,
  reported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fault_reports_workshop  ON part_fault_reports(workshop_id);
CREATE INDEX IF NOT EXISTS idx_fault_reports_inventory ON part_fault_reports(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_fault_reports_status    ON part_fault_reports(workshop_id, status);
