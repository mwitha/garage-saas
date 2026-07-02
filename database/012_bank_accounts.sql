-- ============================================================
-- Bank Accounts
-- Company bank account details per workshop
-- ============================================================

CREATE TABLE bank_accounts (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id    UUID          NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  bank_name      TEXT          NOT NULL,
  branch_name    TEXT,
  account_name   TEXT          NOT NULL,
  account_number TEXT          NOT NULL,
  account_type   TEXT          NOT NULL DEFAULT 'current',
  swift_code     TEXT,
  is_primary     BOOLEAN       NOT NULL DEFAULT false,
  notes          TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_accounts_workshop ON bank_accounts(workshop_id);
