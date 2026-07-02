-- Add payment reference to invoices (cheque number, bank transfer ref, etc.)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;
