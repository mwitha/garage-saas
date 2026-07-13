-- ============================================================
-- Issue Notes
-- Records inventory issued out (given away) for reasons other than
-- a sale — warranty replacement, internal use, staff use, etc.
-- Mirrors the GRN (goods received) pattern but for stock leaving.
-- ============================================================

CREATE TABLE IF NOT EXISTS issue_notes (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id  UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  issue_number TEXT        NOT NULL,
  issued_to    TEXT        NOT NULL,
  reason       TEXT,
  issued_at    DATE        NOT NULL DEFAULT CURRENT_DATE,
  status       TEXT        NOT NULL DEFAULT 'draft',  -- draft | posted
  created_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  posted_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workshop_id, issue_number)
);

CREATE INDEX IF NOT EXISTS idx_issue_notes_workshop ON issue_notes(workshop_id);

CREATE TRIGGER trg_issue_notes_updated_at
  BEFORE UPDATE ON issue_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS issue_note_items (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_note_id     UUID          NOT NULL REFERENCES issue_notes(id) ON DELETE CASCADE,
  inventory_item_id UUID          NOT NULL REFERENCES inventory_items(id),
  quantity          NUMERIC(10,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issue_note_items_note ON issue_note_items(issue_note_id);

ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS issue_note_counter INTEGER NOT NULL DEFAULT 0;

ALTER TABLE stock_adjustments
  ADD COLUMN IF NOT EXISTS issue_note_id UUID REFERENCES issue_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_adj_issue_note ON stock_adjustments(issue_note_id) WHERE issue_note_id IS NOT NULL;
