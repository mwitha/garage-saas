-- Support ad-hoc "quick SMS" sends to people who aren't a customer record
-- (e.g. a supplier or other contact), not just existing customers.
ALTER TABLE notifications ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_name TEXT;
