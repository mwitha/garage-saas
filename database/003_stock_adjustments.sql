CREATE TABLE IF NOT EXISTS stock_adjustments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id         UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  inventory_item_id   UUID        NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_change     NUMERIC(10,2) NOT NULL,
  note                TEXT,
  adjusted_by         UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_adj_workshop ON stock_adjustments(workshop_id);
CREATE INDEX idx_stock_adj_item     ON stock_adjustments(inventory_item_id);
