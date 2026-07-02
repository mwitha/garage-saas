-- Soft delete for customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(workshop_id) WHERE deleted_at IS NULL;

-- work_order_items was missing (forward-reference to inventory_items in original schema)
CREATE TABLE IF NOT EXISTS work_order_items (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id         UUID          NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  work_order_id       UUID          NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  inventory_item_id   UUID          REFERENCES inventory_items(id),
  description         TEXT          NOT NULL,
  quantity            NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price          NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_order_items_order ON work_order_items(work_order_id);
