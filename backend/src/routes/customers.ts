import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// --- Schemas ---

const customerSchema = z.object({
  name:       z.string().min(1),
  phone:      z.string().min(1),
  email:      z.string().email().optional(),
  address:    z.string().optional(),
  city:       z.string().optional(),
  nic_number: z.string().optional(),
  notes:      z.string().optional(),
});

const updateCustomerSchema = customerSchema.partial();

const listQuerySchema = z.object({
  search: z.string().optional(),
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
});

// --- Column lists ---

const CUSTOMER_COLS = `id, name, phone, email, address, city, nic_number, notes, created_at, updated_at`;

const CUSTOMER_LIST_COLS = `${CUSTOMER_COLS},
  (SELECT COUNT(*)::int FROM vehicles
   WHERE customer_id = customers.id) AS vehicle_count,
  (SELECT MAX(wo.created_at) FROM work_orders wo
   JOIN vehicles v ON v.id = wo.vehicle_id
   WHERE v.customer_id = customers.id
     AND wo.workshop_id = customers.workshop_id) AS last_visit`;

// Columns returned when fetching vehicles for a customer detail view
const VEHICLE_COLS = `id, customer_id, plate_number, make, model, year, color,
  fuel_type, engine_capacity, engine_number, transmission, mileage, vin,
  ac_system, notes, created_at, updated_at`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Response helpers ---

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data, error: null });
}

function fail(res: Response, status: number, message: string, details?: unknown): void {
  res.status(status).json({ data: null, error: { message, ...(details ? { details } : {}) } });
}

// --- Routes ---

// GET /api/customers
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'Invalid query parameters', parsed.error.flatten());
    return;
  }

  const { search, page, limit } = parsed.data;
  const { workshopId } = req.user!;
  const offset = (page - 1) * limit;

  const baseParams: unknown[] = [workshopId];
  let searchClause = '';

  if (search?.trim()) {
    baseParams.push(`%${search.trim()}%`);
    const p = baseParams.length;
    searchClause = ` AND (name ILIKE $${p} OR phone ILIKE $${p} OR COALESCE(email,'') ILIKE $${p})`;
  }

  try {
    const [countResult, dataResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM customers
         WHERE workshop_id = $1 AND deleted_at IS NULL${searchClause}`,
        baseParams,
      ),
      pool.query(
        `SELECT ${CUSTOMER_LIST_COLS}
         FROM customers
         WHERE workshop_id = $1 AND deleted_at IS NULL${searchClause}
         ORDER BY name ASC
         LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`,
        [...baseParams, limit, offset],
      ),
    ]);

    ok(res, {
      customers: dataResult.rows,
      total:     parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('List customers error:', err);
    fail(res, 500, 'Failed to fetch customers');
  }
});

// GET /api/customers/:id  — includes vehicles + recent work orders
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Customer not found'); return; }

  const { workshopId } = req.user!;

  try {
    const [customerResult, vehiclesResult, ordersResult, invoicesResult] = await Promise.all([
      pool.query(
        `SELECT ${CUSTOMER_COLS}
         FROM customers
         WHERE id = $1 AND workshop_id = $2 AND deleted_at IS NULL`,
        [id, workshopId],
      ),
      pool.query(
        `SELECT ${VEHICLE_COLS}
         FROM vehicles
         WHERE customer_id = $1 AND workshop_id = $2
         ORDER BY plate_number ASC`,
        [id, workshopId],
      ),
      pool.query(
        `SELECT wo.id, wo.order_number, wo.status,
                wo.customer_complaint, wo.created_at, wo.completed_at,
                v.plate_number, v.make, v.model
         FROM work_orders wo
         JOIN vehicles v ON v.id = wo.vehicle_id
         WHERE v.customer_id = $1 AND wo.workshop_id = $2
         ORDER BY wo.created_at DESC
         LIMIT 20`,
        [id, workshopId],
      ),
      pool.query(
        `SELECT i.id, i.invoice_number, i.status, i.total::float, i.due_date, i.created_at,
                v.plate_number, v.make, v.model, wo.order_number
         FROM invoices i
         JOIN work_orders wo ON wo.id = i.work_order_id
         JOIN vehicles v ON v.id = wo.vehicle_id
         WHERE v.customer_id = $1 AND i.workshop_id = $2
           AND i.status IN ('draft', 'sent', 'overdue')
         ORDER BY i.created_at DESC`,
        [id, workshopId],
      ),
    ]);

    if (customerResult.rows.length === 0) { fail(res, 404, 'Customer not found'); return; }

    ok(res, {
      ...customerResult.rows[0],
      vehicles:             vehiclesResult.rows,
      recent_work_orders:   ordersResult.rows,
      outstanding_invoices: invoicesResult.rows,
    });
  } catch (err) {
    console.error('Get customer error:', err);
    fail(res, 500, 'Failed to fetch customer');
  }
});

// POST /api/customers
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'Validation failed', parsed.error.flatten()); return; }

  const { name, phone, email, address, city, nic_number, notes } = parsed.data;
  const { workshopId } = req.user!;

  try {
    const { rows } = await pool.query(
      `INSERT INTO customers (workshop_id, name, phone, email, address, city, nic_number, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${CUSTOMER_COLS}`,
      [workshopId, name, phone, email ?? null, address ?? null, city ?? null, nic_number ?? null, notes ?? null],
    );
    ok(res, rows[0], 201);
  } catch (err) {
    console.error('Create customer error:', err);
    fail(res, 500, 'Failed to create customer');
  }
});

// PUT /api/customers/:id
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Customer not found'); return; }

  const parsed = updateCustomerSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'Validation failed', parsed.error.flatten()); return; }

  const fields = parsed.data;
  if (Object.keys(fields).length === 0) { fail(res, 400, 'No fields provided for update'); return; }

  const { workshopId } = req.user!;

  const ALLOWED_COLS = ['name', 'phone', 'email', 'address', 'city', 'nic_number', 'notes'] as const;
  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const col of ALLOWED_COLS) {
    if (col in fields) {
      params.push(fields[col] ?? null);
      setClauses.push(`${col} = $${params.length}`);
    }
  }

  params.push(id, workshopId);
  const idIdx = params.length - 1;
  const wsIdx = params.length;

  try {
    const { rows } = await pool.query(
      `UPDATE customers
       SET ${setClauses.join(', ')}
       WHERE id = $${idIdx} AND workshop_id = $${wsIdx} AND deleted_at IS NULL
       RETURNING ${CUSTOMER_COLS}`,
      params,
    );
    if (rows.length === 0) { fail(res, 404, 'Customer not found'); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error('Update customer error:', err);
    fail(res, 500, 'Failed to update customer');
  }
});

// DELETE /api/customers/:id  — soft delete
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Customer not found'); return; }

  const { workshopId } = req.user!;

  try {
    const { rows } = await pool.query(
      `UPDATE customers
       SET deleted_at = NOW()
       WHERE id = $1 AND workshop_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, workshopId],
    );
    if (rows.length === 0) { fail(res, 404, 'Customer not found'); return; }
    ok(res, { id: rows[0].id });
  } catch (err) {
    console.error('Delete customer error:', err);
    fail(res, 500, 'Failed to delete customer');
  }
});

export default router;
