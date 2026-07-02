-- ============================================================
-- User Permissions
-- Granular section-level access control per user
-- ============================================================

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id     UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section     TEXT  NOT NULL,
  PRIMARY KEY (user_id, section)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);

-- Seed default permissions for all existing non-owner users based on their role
INSERT INTO user_permissions (user_id, section)
SELECT u.id, s.section
FROM users u
CROSS JOIN (VALUES
  -- admin gets everything
  ('admin',           'customers'),
  ('admin',           'work_orders'),
  ('admin',           'invoices'),
  ('admin',           'inventory'),
  ('admin',           'reports'),
  ('admin',           'employees'),
  ('admin',           'suppliers'),
  ('admin',           'settings'),
  -- service_advisor: customer-facing + ops
  ('service_advisor', 'customers'),
  ('service_advisor', 'work_orders'),
  ('service_advisor', 'invoices'),
  -- technician: work orders only
  ('technician',      'work_orders')
) AS s(role, section)
WHERE u.role = s.role::user_role
ON CONFLICT DO NOTHING;
