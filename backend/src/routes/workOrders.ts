import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';
import { sendJobReadySMS } from '../services/notifications';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// Status machine
// =============================================================================

const STATUSES = [
  'received', 'diagnosing', 'waiting_parts', 'in_progress',
  'quality_check', 'ready', 'delivered', 'cancelled',
] as const;

type WorkOrderStatus = typeof STATUSES[number];

// Each status maps to the set of statuses it may move to.
// quality_check → in_progress is intentional: allows rework loops.
// cancelled is a terminal sink reachable from any open state.
const TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  received:      ['diagnosing', 'cancelled'],
  diagnosing:    ['waiting_parts', 'in_progress', 'cancelled'],
  waiting_parts: ['in_progress', 'cancelled'],
  in_progress:   ['quality_check', 'cancelled'],
  quality_check: ['ready', 'in_progress'],
  ready:         ['delivered', 'cancelled'],
  delivered:     [],
  cancelled:     [],
};

// =============================================================================
// Schemas
// =============================================================================

const createSchema = z.object({
  vehicle_id:         z.string().uuid(),
  assigned_to:        z.string().uuid().nullable().optional(),
  customer_complaint: z.string().optional(),
  diagnosis:          z.string().optional(),
  internal_notes:     z.string().optional(),
  mileage_in:         z.number().int().nonnegative().optional(),
  labour_cost:        z.number().nonnegative().optional(),
  promised_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
});

const addItemSchema = z.object({
  inventory_item_id: z.string().uuid().nullable().optional(),
  service_item_id:   z.string().uuid().nullable().optional(),
  description:       z.string().min(1),
  quantity:          z.number().positive(),
  unit_price:        z.number().nonnegative(),
});

// Updates can also set mileage_out (recorded when the car is returned)
const updateSchema = createSchema.partial().extend({
  mileage_out: z.number().int().nonnegative().optional(),
});

const statusSchema = z.object({
  status: z.enum(STATUSES),
});

const listQuerySchema = z.object({
  status:     z.enum(STATUSES).optional(),
  vehicleId:  z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  search:     z.string().optional(),
  page:       z.coerce.number().int().positive().default(1),
  limit:      z.coerce.number().int().positive().max(100).default(20),
});

// =============================================================================
// Column definitions
// =============================================================================

// Full column list with table-qualified names for JOIN queries
const WO_COLS = `
  wo.id, wo.workshop_id, wo.vehicle_id, wo.assigned_to, wo.order_number,
  wo.status, wo.customer_complaint, wo.diagnosis, wo.internal_notes,
  wo.mileage_in, wo.mileage_out, wo.labour_cost, wo.promised_date,
  wo.completed_at, wo.created_at, wo.updated_at`;

const WO_JOINS = `
  JOIN vehicles  v ON v.id = wo.vehicle_id
  JOIN customers c ON c.id = v.customer_id
  LEFT JOIN users u ON u.id = wo.assigned_to`;

// Extra columns pulled from JOINed tables
const WO_RELATED = `
  v.plate_number, v.make, v.model, v.year,
  c.id   AS customer_id,
  c.name AS customer_name,
  c.phone AS customer_phone,
  u.name AS assigned_to_name`;

// Bare column list used in RETURNING clauses (no JOIN)
const WO_COLS_BARE = `
  id, workshop_id, vehicle_id, assigned_to, order_number, status,
  customer_complaint, diagnosis, internal_notes, mileage_in, mileage_out,
  labour_cost, promised_date, completed_at, created_at, updated_at`;

const UPDATABLE_COLS = [
  'vehicle_id', 'assigned_to', 'customer_complaint', 'diagnosis',
  'internal_notes', 'mileage_in', 'mileage_out', 'labour_cost', 'promised_date',
] as const;

// =============================================================================
// Helpers
// =============================================================================

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data, error: null });
}

function fail(res: Response, status: number, message: string, details?: unknown): void {
  res.status(status).json({ data: null, error: { message, ...(details ? { details } : {}) } });
}

// =============================================================================
// Routes
// =============================================================================

// GET /api/work-orders
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'Invalid query parameters', parsed.error.flatten());
    return;
  }

  const { status, vehicleId, assignedTo, search, page, limit } = parsed.data;
  const { workshopId } = req.user!;
  const offset = (page - 1) * limit;

  const conditions: string[] = ['wo.workshop_id = $1'];
  const params: unknown[] = [workshopId];

  if (status) {
    params.push(status);
    conditions.push(`wo.status = $${params.length}`);
  }
  if (vehicleId) {
    params.push(vehicleId);
    conditions.push(`wo.vehicle_id = $${params.length}`);
  }
  if (assignedTo) {
    params.push(assignedTo);
    conditions.push(`wo.assigned_to = $${params.length}`);
  }
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    const p = params.length;
    conditions.push(
      `(wo.order_number ILIKE $${p} OR c.name ILIKE $${p} OR v.plate_number ILIKE $${p})`,
    );
  }

  const where = conditions.join(' AND ');

  try {
    const [countResult, dataResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM work_orders wo ${WO_JOINS} WHERE ${where}`,
        params,
      ),
      pool.query(
        `SELECT ${WO_COLS}, ${WO_RELATED}
         FROM work_orders wo ${WO_JOINS}
         WHERE ${where}
         ORDER BY wo.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    ok(res, {
      work_orders: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('List work orders error:', err);
    fail(res, 500, 'Failed to fetch work orders');
  }
});

// GET /api/work-orders/:id
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    fail(res, 404, 'Work order not found');
    return;
  }

  const { workshopId } = req.user!;

  try {
    const [woResult, itemsResult] = await Promise.all([
      pool.query(
        `SELECT ${WO_COLS}, ${WO_RELATED}
         FROM work_orders wo ${WO_JOINS}
         WHERE wo.id = $1 AND wo.workshop_id = $2`,
        [id, workshopId],
      ),
      pool.query(
        `SELECT
           woi.id, woi.inventory_item_id, woi.service_item_id, woi.description,
           woi.quantity::float, woi.unit_price::float, woi.line_total::float,
           woi.created_at, woi.stock_adjustment_id,
           inv.part_number, inv.unit, inv.quantity::float AS stock_quantity,
           inv.reorder_threshold::float, inv.name AS inventory_name,
           inv.supplier_name, inv.supplier_phone,
           svc.name AS service_name, svc.category AS service_category
         FROM work_order_items woi
         LEFT JOIN inventory_items inv ON inv.id = woi.inventory_item_id
         LEFT JOIN service_items svc ON svc.id = woi.service_item_id
         WHERE woi.work_order_id = $1
         ORDER BY woi.created_at ASC`,
        [id],
      ),
    ]);

    if (woResult.rows.length === 0) {
      fail(res, 404, 'Work order not found');
      return;
    }

    const wo = woResult.rows[0];
    wo.labour_cost = parseFloat(wo.labour_cost) || 0;
    const partsTotal = itemsResult.rows.reduce((sum: number, r: { line_total: number }) => sum + r.line_total, 0);

    ok(res, {
      ...wo,
      items: itemsResult.rows,
      parts_total: partsTotal,
      total: wo.labour_cost + partsTotal,
    });
  } catch (err) {
    console.error('Get work order error:', err);
    fail(res, 500, 'Failed to fetch work order');
  }
});

// POST /api/work-orders
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'Validation failed', parsed.error.flatten());
    return;
  }

  const {
    vehicle_id, assigned_to, customer_complaint, diagnosis,
    internal_notes, mileage_in, labour_cost, promised_date,
  } = parsed.data;
  const { workshopId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify vehicle belongs to this workshop
    const vehicleCheck = await client.query(
      'SELECT 1 FROM vehicles WHERE id = $1 AND workshop_id = $2',
      [vehicle_id, workshopId],
    );
    if ((vehicleCheck.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Vehicle not found');
      return;
    }

    // Verify assigned technician belongs to this workshop (when provided)
    if (assigned_to) {
      const userCheck = await client.query(
        'SELECT 1 FROM users WHERE id = $1 AND workshop_id = $2 AND active = true',
        [assigned_to, workshopId],
      );
      if ((userCheck.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        fail(res, 400, 'Assigned user not found in this workshop');
        return;
      }
    }

    // Atomically increment the counter and derive the order number.
    // Using UPDATE ... RETURNING means concurrent inserts each get a unique counter.
    const counterResult = await client.query(
      `UPDATE workshops
       SET order_counter = order_counter + 1
       WHERE id = $1
       RETURNING order_counter, order_prefix`,
      [workshopId],
    );
    const { order_counter, order_prefix } = counterResult.rows[0];
    const orderNumber = `${order_prefix}-${String(order_counter).padStart(5, '0')}`;

    const { rows } = await client.query(
      `INSERT INTO work_orders
         (workshop_id, vehicle_id, assigned_to, order_number,
          customer_complaint, diagnosis, internal_notes,
          mileage_in, labour_cost, promised_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${WO_COLS_BARE}`,
      [
        workshopId, vehicle_id, assigned_to ?? null, orderNumber,
        customer_complaint ?? null, diagnosis ?? null, internal_notes ?? null,
        mileage_in ?? null, labour_cost ?? 0, promised_date ?? null,
      ],
    );

    await client.query('COMMIT');
    ok(res, rows[0], 201);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create work order error:', err);
    fail(res, 500, 'Failed to create work order');
  } finally {
    client.release();
  }
});

// PUT /api/work-orders/:id
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    fail(res, 404, 'Work order not found');
    return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'Validation failed', parsed.error.flatten());
    return;
  }

  const fields = parsed.data;
  if (Object.keys(fields).length === 0) {
    fail(res, 400, 'No fields provided for update');
    return;
  }

  const { workshopId } = req.user!;

  // Cross-workshop ownership checks before touching the DB
  if (fields.vehicle_id) {
    const check = await pool.query(
      'SELECT 1 FROM vehicles WHERE id = $1 AND workshop_id = $2',
      [fields.vehicle_id, workshopId],
    );
    if ((check.rowCount ?? 0) === 0) {
      fail(res, 404, 'Vehicle not found');
      return;
    }
  }
  if (fields.assigned_to) {
    const check = await pool.query(
      'SELECT 1 FROM users WHERE id = $1 AND workshop_id = $2 AND active = true',
      [fields.assigned_to, workshopId],
    );
    if ((check.rowCount ?? 0) === 0) {
      fail(res, 400, 'Assigned user not found in this workshop');
      return;
    }
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const col of UPDATABLE_COLS) {
    if (col in fields) {
      params.push((fields as Record<string, unknown>)[col] ?? null);
      setClauses.push(`${col} = $${params.length}`);
    }
  }

  params.push(id, workshopId);
  const idIdx = params.length - 1;
  const wsIdx = params.length;

  try {
    const { rows } = await pool.query(
      `UPDATE work_orders
       SET ${setClauses.join(', ')}
       WHERE id = $${idIdx} AND workshop_id = $${wsIdx}
       RETURNING ${WO_COLS_BARE}`,
      params,
    );

    if (rows.length === 0) {
      fail(res, 404, 'Work order not found');
      return;
    }

    ok(res, rows[0]);
  } catch (err) {
    console.error('Update work order error:', err);
    fail(res, 500, 'Failed to update work order');
  }
});

// PATCH /api/work-orders/:id/status
router.patch('/:id/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    fail(res, 404, 'Work order not found');
    return;
  }

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'Validation failed', parsed.error.flatten());
    return;
  }

  const { status: newStatus } = parsed.data;
  const { workshopId } = req.user!;

  try {
    const currentResult = await pool.query(
      'SELECT status FROM work_orders WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );

    if (currentResult.rows.length === 0) {
      fail(res, 404, 'Work order not found');
      return;
    }

    const currentStatus = currentResult.rows[0].status as WorkOrderStatus;
    const allowed = TRANSITIONS[currentStatus];

    if (!allowed.includes(newStatus)) {
      const hint = allowed.length ? allowed.join(', ') : 'none (terminal state)';
      fail(res, 422, `Cannot transition '${currentStatus}' → '${newStatus}'. Allowed: ${hint}`);
      return;
    }

    // Set completed_at only when the order is delivered for the first time
    const extraSet = newStatus === 'delivered' ? ', completed_at = NOW()' : '';

    const { rows } = await pool.query(
      `UPDATE work_orders
       SET status = $1${extraSet}
       WHERE id = $2 AND workshop_id = $3
       RETURNING ${WO_COLS_BARE}`,
      [newStatus, id, workshopId],
    );

    ok(res, rows[0]);

    // Fire-and-forget: SMS the customer when their car is ready
    if (newStatus === 'ready') {
      const vehicleId = (rows[0] as { vehicle_id: string }).vehicle_id;
      pool.query<{ customer_id: string }>(
        'SELECT customer_id FROM vehicles WHERE id = $1',
        [vehicleId],
      ).then((r) => {
        if (!r.rows[0]) return;
        return sendJobReadySMS(r.rows[0].customer_id, id);
      }).catch((err: unknown) => {
        console.error('[notifications] job-ready SMS failed (non-fatal):', err);
      });
    }
  } catch (err) {
    console.error('Status transition error:', err);
    fail(res, 500, 'Failed to update status');
  }
});

// POST /api/work-orders/:id/items
router.post('/:id/items', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    fail(res, 404, 'Work order not found');
    return;
  }

  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'Validation failed', parsed.error.flatten());
    return;
  }

  const { inventory_item_id, service_item_id, description, quantity, unit_price } = parsed.data;
  const { workshopId } = req.user!;

  if (inventory_item_id && service_item_id) {
    fail(res, 400, 'Item cannot reference both a part and a service');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify work order belongs to this workshop
    const woCheck = await client.query(
      'SELECT id, status FROM work_orders WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if ((woCheck.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Work order not found');
      return;
    }
    if (woCheck.rows[0].status === 'delivered' || woCheck.rows[0].status === 'cancelled') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Cannot add items to a delivered or cancelled work order');
      return;
    }

    if (service_item_id) {
      const svc = await client.query(
        'SELECT id FROM service_items WHERE id = $1 AND workshop_id = $2',
        [service_item_id, workshopId],
      );
      if ((svc.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        fail(res, 404, 'Service not found');
        return;
      }
    }

    let lowStock = false;
    let stockRemaining = 0;

    if (inventory_item_id) {
      // Lock the inventory row to prevent race conditions
      const inv = await client.query(
        'SELECT id, quantity, reorder_threshold FROM inventory_items WHERE id = $1 AND workshop_id = $2 FOR UPDATE',
        [inventory_item_id, workshopId],
      );
      if ((inv.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        fail(res, 404, 'Inventory item not found');
        return;
      }

      const available = parseFloat(inv.rows[0].quantity);
      if (available < quantity) {
        await client.query('ROLLBACK');
        fail(res, 422, `Insufficient stock: ${available} available, ${quantity} requested`);
        return;
      }

      const newQty = available - quantity;
      stockRemaining = newQty;
      lowStock = newQty <= parseFloat(inv.rows[0].reorder_threshold);

      await client.query(
        'UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2',
        [newQty, inventory_item_id],
      );
    }

    const { rows } = await client.query(
      `INSERT INTO work_order_items
         (workshop_id, work_order_id, inventory_item_id, service_item_id, description, quantity, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id, inventory_item_id, service_item_id, description,
         quantity::float, unit_price::float, line_total::float, created_at`,
      [workshopId, id, inventory_item_id ?? null, service_item_id ?? null, description, quantity, unit_price],
    );

    await client.query('COMMIT');
    ok(res, { item: rows[0], low_stock: lowStock, stock_remaining: stockRemaining }, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Add work order item error:', err);
    fail(res, 500, 'Failed to add item');
  } finally {
    client.release();
  }
});

// DELETE /api/work-orders/:id/items/:itemId
router.delete('/:id/items/:itemId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const itemId = req.params.itemId as string;
  if (!UUID_RE.test(id) || !UUID_RE.test(itemId)) {
    fail(res, 404, 'Not found');
    return;
  }

  const { workshopId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify work order ownership
    const woCheck = await client.query(
      'SELECT id, status FROM work_orders WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if ((woCheck.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Work order not found');
      return;
    }
    if (woCheck.rows[0].status === 'delivered') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Cannot remove items from a delivered work order');
      return;
    }

    // Fetch the item (lock it)
    const item = await client.query(
      `SELECT id, inventory_item_id, quantity::float AS quantity
       FROM work_order_items WHERE id = $1 AND work_order_id = $2
       FOR UPDATE`,
      [itemId, id],
    );
    if ((item.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Item not found');
      return;
    }

    // Return stock to inventory if this was a linked item
    if (item.rows[0].inventory_item_id) {
      await client.query(
        'UPDATE inventory_items SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2',
        [item.rows[0].quantity, item.rows[0].inventory_item_id],
      );
    }

    await client.query('DELETE FROM work_order_items WHERE id = $1', [itemId]);
    await client.query('COMMIT');
    ok(res, { id: itemId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete work order item error:', err);
    fail(res, 500, 'Failed to delete item');
  } finally {
    client.release();
  }
});

// DELETE /api/work-orders/:id
// Delivered orders are financial records — block deletion to protect audit trail.
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    fail(res, 404, 'Work order not found');
    return;
  }

  const { workshopId } = req.user!;

  try {
    const current = await pool.query(
      'SELECT status FROM work_orders WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );

    if (current.rows.length === 0) {
      fail(res, 404, 'Work order not found');
      return;
    }

    if (current.rows[0].status === 'delivered') {
      fail(res, 409, 'Delivered work orders cannot be deleted');
      return;
    }

    const { rows } = await pool.query(
      'DELETE FROM work_orders WHERE id = $1 AND workshop_id = $2 RETURNING id',
      [id, workshopId],
    );

    ok(res, { id: rows[0].id });
  } catch (err) {
    console.error('Delete work order error:', err);
    fail(res, 500, 'Failed to delete work order');
  }
});

export default router;
