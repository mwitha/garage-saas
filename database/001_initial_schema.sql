-- ============================================================
-- Garage SaaS – Initial Schema Migration
-- Stack: PostgreSQL 15+, Node/Express, React/TypeScript
-- Multi-tenant: every table (except workshops) carries workshop_id
-- Run: psql -d your_db -f 001_initial_schema.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'service_advisor', 'technician');

CREATE TYPE plan_type AS ENUM ('trial', 'basic', 'standard', 'pro');

CREATE TYPE work_order_status AS ENUM (
  'received',
  'diagnosing',
  'waiting_parts',
  'in_progress',
  'quality_check',
  'ready',
  'delivered',
  'cancelled'
);

CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');

CREATE TYPE payment_method AS ENUM ('cash', 'card', 'bank_transfer', 'cheque', 'other');

CREATE TYPE notification_channel AS ENUM ('sms', 'email', 'whatsapp');

CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed', 'cancelled');

CREATE TYPE notification_type AS ENUM (
  'job_received',
  'job_ready',
  'job_delivered',
  'service_reminder',
  'invoice_sent',
  'payment_received',
  'custom'
);

CREATE TYPE fuel_type AS ENUM ('petrol', 'diesel', 'hybrid', 'electric', 'lpg', 'other');

-- ============================================================
-- WORKSHOPS  (one row = one tenant)
-- ============================================================

CREATE TABLE workshops (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT        NOT NULL,
  plan              plan_type   NOT NULL DEFAULT 'trial',
  owner_email       TEXT        NOT NULL UNIQUE,
  phone             TEXT,
  address           TEXT,
  city              TEXT,
  logo_url          TEXT,
  currency          TEXT        NOT NULL DEFAULT 'LKR',
  tax_label         TEXT        NOT NULL DEFAULT 'VAT',    -- or 'NBT', 'SVT'
  tax_rate          NUMERIC(5,2) NOT NULL DEFAULT 0,       -- e.g. 18.00 for 18%
  invoice_prefix    TEXT        NOT NULL DEFAULT 'INV',
  order_prefix      TEXT        NOT NULL DEFAULT 'WO',
  active            BOOLEAN     NOT NULL DEFAULT true,
  trial_ends_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USERS  (staff of a workshop)
-- ============================================================

CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id     UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL,
  password_hash   TEXT        NOT NULL,
  role            user_role   NOT NULL DEFAULT 'technician',
  phone           TEXT,
  avatar_url      TEXT,
  active          BOOLEAN     NOT NULL DEFAULT true,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- email must be unique within a workshop (not globally)
  UNIQUE (workshop_id, email)
);

-- ============================================================
-- CUSTOMERS
-- ============================================================

CREATE TABLE customers (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id     UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  phone           TEXT        NOT NULL,
  email           TEXT,
  address         TEXT,
  city            TEXT,
  nic_number      TEXT,         -- Sri Lanka National ID Card
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- VEHICLES  (linked to a customer)
-- ============================================================

CREATE TABLE vehicles (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id     UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  customer_id     UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plate_number    TEXT        NOT NULL,   -- e.g. CAR-1234, WP CAB-1234
  make            TEXT        NOT NULL,   -- e.g. Toyota
  model           TEXT        NOT NULL,   -- e.g. Aqua
  year            SMALLINT,
  color           TEXT,
  fuel_type       fuel_type,
  engine_capacity TEXT,                   -- e.g. "1500cc"
  transmission    TEXT,                   -- 'manual' | 'auto'
  mileage         INTEGER,                -- km at last service
  vin             TEXT,                   -- chassis/VIN
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- plate should be unique per workshop
  UNIQUE (workshop_id, plate_number)
);

-- ============================================================
-- WORK ORDERS
-- ============================================================

CREATE TABLE work_orders (
  id              UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id     UUID              NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  vehicle_id      UUID              NOT NULL REFERENCES vehicles(id),
  assigned_to     UUID              REFERENCES users(id),        -- technician
  order_number    TEXT              NOT NULL,                    -- WO-00001
  status          work_order_status NOT NULL DEFAULT 'received',
  customer_complaint TEXT,
  diagnosis       TEXT,
  internal_notes  TEXT,
  mileage_in      INTEGER,
  mileage_out     INTEGER,
  labour_cost     NUMERIC(12,2)     NOT NULL DEFAULT 0,
  promised_date   DATE,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  UNIQUE (workshop_id, order_number)
);

-- ============================================================
-- WORK ORDER ITEMS  (parts/services on a work order)
-- ============================================================

CREATE TABLE work_order_items (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id         UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  work_order_id       UUID        NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  inventory_item_id   UUID        REFERENCES inventory_items(id),  -- nullable: custom line item
  description         TEXT        NOT NULL,
  quantity            NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price          NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INVENTORY ITEMS  (spare parts & consumables)
-- ============================================================

CREATE TABLE inventory_items (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id       UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  part_number       TEXT,
  category          TEXT,        -- e.g. 'filters', 'brakes', 'ac_parts'
  unit              TEXT        NOT NULL DEFAULT 'pcs',  -- pcs, litres, metres
  quantity          NUMERIC(10,2) NOT NULL DEFAULT 0,
  reorder_threshold NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost_price        NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
  supplier_name     TEXT,
  supplier_phone    TEXT,
  location          TEXT,        -- shelf/bin location in the workshop
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INVOICES  (one per work order)
-- ============================================================

CREATE TABLE invoices (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id     UUID            NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  work_order_id   UUID            NOT NULL REFERENCES work_orders(id),
  invoice_number  TEXT            NOT NULL,               -- INV-00001
  status          invoice_status  NOT NULL DEFAULT 'draft',
  subtotal        NUMERIC(12,2)   NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5,2)    NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(12,2)   NOT NULL DEFAULT 0,
  discount        NUMERIC(12,2)   NOT NULL DEFAULT 0,
  total           NUMERIC(12,2)   NOT NULL DEFAULT 0,
  notes           TEXT,
  payment_method  payment_method,
  paid_at         TIMESTAMPTZ,
  due_date        DATE,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  UNIQUE (workshop_id, invoice_number)
);

-- ============================================================
-- INVOICE ITEMS  (line items snapshotted from work order)
-- ============================================================

CREATE TABLE invoice_items (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id      UUID        NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description     TEXT        NOT NULL,
  quantity        NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total      NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

-- ============================================================
-- EMPLOYEES  (links a user to HR/payroll info)
-- ============================================================

CREATE TABLE employees (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id     UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES users(id),       -- nullable: employee with no login
  name            TEXT        NOT NULL,
  role            TEXT        NOT NULL,                   -- e.g. 'lead technician'
  phone           TEXT,
  nic_number      TEXT,
  hourly_rate     NUMERIC(10,2),
  monthly_salary  NUMERIC(12,2),
  joined_at       DATE,
  active          BOOLEAN     NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS  (SMS / email / WhatsApp log)
-- ============================================================

CREATE TABLE notifications (
  id              UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id     UUID                  NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  customer_id     UUID                  NOT NULL REFERENCES customers(id),
  work_order_id   UUID                  REFERENCES work_orders(id),
  type            notification_type     NOT NULL,
  channel         notification_channel  NOT NULL,
  status          notification_status   NOT NULL DEFAULT 'pending',
  recipient       TEXT                  NOT NULL,   -- phone number or email
  message         TEXT                  NOT NULL,
  external_id     TEXT,                             -- ID from SMS/email provider
  error_message   TEXT,
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG  (optional but recommended)
-- ============================================================

CREATE TABLE audit_logs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id     UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES users(id),
  action          TEXT        NOT NULL,   -- 'create', 'update', 'delete'
  table_name      TEXT        NOT NULL,
  record_id       UUID        NOT NULL,
  old_values      JSONB,
  new_values      JSONB,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES  (query performance for multi-tenant filtering)
-- ============================================================

-- Core tenant scoping — every WHERE workshop_id = $1 query hits these
CREATE INDEX idx_users_workshop           ON users(workshop_id);
CREATE INDEX idx_customers_workshop       ON customers(workshop_id);
CREATE INDEX idx_vehicles_workshop        ON vehicles(workshop_id);
CREATE INDEX idx_vehicles_customer        ON vehicles(customer_id);
CREATE INDEX idx_work_orders_workshop     ON work_orders(workshop_id);
CREATE INDEX idx_work_orders_vehicle      ON work_orders(vehicle_id);
CREATE INDEX idx_work_orders_assigned     ON work_orders(assigned_to);
CREATE INDEX idx_work_orders_status       ON work_orders(workshop_id, status);
CREATE INDEX idx_work_order_items_order   ON work_order_items(work_order_id);
CREATE INDEX idx_invoices_workshop        ON invoices(workshop_id);
CREATE INDEX idx_invoices_work_order      ON invoices(work_order_id);
CREATE INDEX idx_invoices_status          ON invoices(workshop_id, status);
CREATE INDEX idx_inventory_workshop       ON inventory_items(workshop_id);
CREATE INDEX idx_inventory_low_stock      ON inventory_items(workshop_id) WHERE quantity <= reorder_threshold;
CREATE INDEX idx_employees_workshop       ON employees(workshop_id);
CREATE INDEX idx_notifications_workshop   ON notifications(workshop_id);
CREATE INDEX idx_notifications_customer   ON notifications(customer_id);
CREATE INDEX idx_notifications_pending    ON notifications(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_audit_logs_workshop      ON audit_logs(workshop_id);
CREATE INDEX idx_audit_logs_record        ON audit_logs(table_name, record_id);

-- Full-text search on customers (name, phone)
CREATE INDEX idx_customers_search ON customers USING gin(
  to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(phone,'') || ' ' || coalesce(email,''))
);

-- Vehicle plate lookup
CREATE INDEX idx_vehicles_plate ON vehicles(workshop_id, lower(plate_number));

-- ============================================================
-- AUTO-UPDATE updated_at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['workshops','users','customers','vehicles','work_orders','inventory_items','invoices','employees']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================
-- SEQUENCE HELPERS  (human-readable order/invoice numbers)
-- ============================================================

-- Sequences are per-workshop — stored in the workshops table as counters
-- Use this function in your Node layer:
--
--   UPDATE workshops
--   SET order_counter = order_counter + 1
--   WHERE id = $workshopId
--   RETURNING order_counter, order_prefix;
--
-- Then format as: `${prefix}-${String(counter).padStart(5,'0')}`

ALTER TABLE workshops ADD COLUMN IF NOT EXISTS order_counter   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS invoice_counter INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- ROW LEVEL SECURITY (optional but strongly recommended)
-- Enable if you use Supabase or want DB-enforced isolation
-- ============================================================

-- ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON customers
--   USING (workshop_id = current_setting('app.workshop_id')::uuid);
-- (repeat for each tenant-scoped table)

-- ============================================================
-- SEED: default superadmin workshop (dev only — remove in prod)
-- ============================================================

-- INSERT INTO workshops (name, plan, owner_email, city, trial_ends_at)
-- VALUES ('Demo Garage', 'trial', 'admin@demo.lk', 'Colombo', NOW() + INTERVAL '14 days');
