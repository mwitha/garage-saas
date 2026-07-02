ALTER TABLE stock_adjustments
  ADD COLUMN IF NOT EXISTS reference_number TEXT,
  ADD COLUMN IF NOT EXISTS work_order_id    UUID REFERENCES work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_adj_work_order
  ON stock_adjustments(work_order_id) WHERE work_order_id IS NOT NULL;
