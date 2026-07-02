-- ============================================================
-- Suppliers & GRN (Goods Received Note)
-- ============================================================

-- Suppliers directory (one per workshop)
CREATE TABLE IF NOT EXISTS suppliers (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_workshop ON suppliers(workshop_id);

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- GRN header
CREATE TABLE IF NOT EXISTS grns (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id      UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  supplier_id      UUID        REFERENCES suppliers(id) ON DELETE SET NULL,
  grn_number       TEXT        NOT NULL,
  supplier_invoice TEXT,                         -- supplier's own invoice/delivery number
  received_at      DATE        NOT NULL DEFAULT CURRENT_DATE,
  notes            TEXT,
  status           TEXT        NOT NULL DEFAULT 'draft',  -- draft | posted
  total_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  posted_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workshop_id, grn_number)
);

CREATE INDEX IF NOT EXISTS idx_grns_workshop  ON grns(workshop_id);
CREATE INDEX IF NOT EXISTS idx_grns_supplier  ON grns(supplier_id);

CREATE TRIGGER trg_grns_updated_at
  BEFORE UPDATE ON grns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- GRN line items
CREATE TABLE IF NOT EXISTS grn_items (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  grn_id              UUID          NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
  inventory_item_id   UUID          NOT NULL REFERENCES inventory_items(id),
  quantity            NUMERIC(10,2) NOT NULL,
  unit_cost           NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED
);

CREATE INDEX IF NOT EXISTS idx_grn_items_grn  ON grn_items(grn_id);

-- GRN counter on workshops
ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS grn_counter INTEGER NOT NULL DEFAULT 0;

-- Fix missing columns on stock_adjustments (used by /api/inventory/:id/adjust)
ALTER TABLE stock_adjustments
  ADD COLUMN IF NOT EXISTS supplier_name    TEXT,
  ADD COLUMN IF NOT EXISTS supplier_phone   TEXT,
  ADD COLUMN IF NOT EXISTS supplier_invoice TEXT,
  ADD COLUMN IF NOT EXISTS unit_cost        NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS batch_note       TEXT,
  ADD COLUMN IF NOT EXISTS grn_id           UUID REFERENCES grns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_adj_grn ON stock_adjustments(grn_id) WHERE grn_id IS NOT NULL;
