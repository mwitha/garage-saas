-- ============================================================
-- Expenses
-- Daily expense tracking per workshop
-- ============================================================

CREATE TABLE expenses (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id     UUID          NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  date            DATE          NOT NULL,
  category        TEXT          NOT NULL,
  description     TEXT          NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT          NOT NULL DEFAULT 'cash',
  reference       TEXT,
  notes           TEXT,
  created_by      UUID          REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_workshop_date ON expenses(workshop_id, date DESC);
CREATE INDEX idx_expenses_workshop_category ON expenses(workshop_id, category);

-- Seed expenses permission for existing admins
INSERT INTO user_permissions (user_id, section)
SELECT u.id, 'expenses'
FROM users u
WHERE u.role = 'admin'::user_role
ON CONFLICT DO NOTHING;
