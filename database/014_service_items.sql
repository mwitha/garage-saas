-- ============================================================
-- Service Items
-- Reusable catalog of billable services (labour, diagnostics, etc.)
-- distinct from physical parts in inventory_items — no stock tracking.
-- ============================================================

CREATE TABLE IF NOT EXISTS service_items (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id   UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  description   TEXT,
  category      TEXT,
  price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_items_workshop ON service_items(workshop_id);

CREATE TRIGGER trg_service_items_updated_at
  BEFORE UPDATE ON service_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Work order items can reference a catalog service instead of an inventory part
ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS service_item_id UUID REFERENCES service_items(id);

ALTER TABLE work_order_items
  ADD CONSTRAINT chk_work_order_items_one_ref
  CHECK (inventory_item_id IS NULL OR service_item_id IS NULL);
