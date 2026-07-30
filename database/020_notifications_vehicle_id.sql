-- Track which vehicle a notification belongs to, so automated sweeps
-- (e.g. 6-month service reminders) can dedupe per-vehicle rather than
-- per-customer (a customer may have multiple vehicles).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES vehicles(id);
CREATE INDEX IF NOT EXISTS idx_notifications_vehicle ON notifications(vehicle_id);
