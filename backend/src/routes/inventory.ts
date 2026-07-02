import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  search:   z.string().optional(),
  category: z.string().optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().positive().max(100).default(50),
});

const itemSchema = z.object({
  name:               z.string().min(1),
  part_number:        z.string().optional().nullable(),
  category:           z.string().optional().nullable(),
  unit:               z.string().min(1).default('pcs'),
  quantity:           z.preprocess((v) => Number(v ?? 0), z.number().nonnegative()),
  reorder_threshold:  z.preprocess((v) => Number(v ?? 0), z.number().nonnegative()),
  cost_price:         z.preprocess((v) => Number(v ?? 0), z.number().nonnegative()),
  selling_price:      z.preprocess((v) => Number(v ?? 0), z.number().nonnegative()),
  supplier_name:      z.string().optional().nullable(),
  supplier_phone:     z.string().optional().nullable(),
  location:           z.string().optional().nullable(),
  notes:              z.string().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Shared SELECT columns
// ---------------------------------------------------------------------------

const SELECT_COLS = `
  id, name, part_number, category, unit,
  quantity::float, reorder_threshold::float,
  cost_price::float, selling_price::float,
  supplier_name, supplier_phone, location, notes,
  created_at, updated_at,
  (quantity <= reorder_threshold) AS low_stock`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ data, error: null });
}
function fail(res: Response, status: number, message: string) {
  res.status(status).json({ data: null, error: { message } });
}

// ---------------------------------------------------------------------------
// GET /api/inventory/low-stock  — MUST be before /:id to avoid route shadowing
// ---------------------------------------------------------------------------

router.get('/low-stock', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLS}
       FROM inventory_items
       WHERE workshop_id = $1 AND quantity <= reorder_threshold
       ORDER BY (reorder_threshold - quantity) DESC, name ASC`,
      [workshopId],
    );
    ok(res, rows);
  } catch (err) {
    console.error('Low stock error:', err);
    fail(res, 500, 'Failed to fetch low-stock items');
  }
});

// ---------------------------------------------------------------------------
// GET /api/inventory
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) { fail(res, 400, 'Invalid query parameters'); return; }

  const { search, category, lowStock, page, limit } = parsed.data;
  const { workshopId } = req.user!;
  const offset = (page - 1) * limit;

  const params: unknown[] = [workshopId];
  const conditions: string[] = ['workshop_id = $1'];

  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`(name ILIKE $${params.length} OR part_number ILIKE $${params.length})`);
  }
  if (category?.trim()) {
    params.push(category.trim());
    conditions.push(`category = $${params.length}`);
  }
  if (lowStock === 'true') {
    conditions.push('quantity <= reorder_threshold');
  }

  const where = conditions.join(' AND ');

  try {
    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM inventory_items WHERE ${where}`, params),
      pool.query(
        `SELECT ${SELECT_COLS}
         FROM inventory_items
         WHERE ${where}
         ORDER BY name ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    ok(res, {
      items: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('List inventory error:', err);
    fail(res, 500, 'Failed to fetch inventory');
  }
});

// ---------------------------------------------------------------------------
// GET /api/inventory/:id
// ---------------------------------------------------------------------------

router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Item not found'); return; }

  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLS} FROM inventory_items WHERE id = $1 AND workshop_id = $2`,
      [id, workshopId],
    );
    if (rows.length === 0) { fail(res, 404, 'Item not found'); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error('Get inventory item error:', err);
    fail(res, 500, 'Failed to fetch item');
  }
});

// ---------------------------------------------------------------------------
// POST /api/inventory
// ---------------------------------------------------------------------------

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const d = parsed.data;
  const { workshopId } = req.user!;

  try {
    const { rows } = await pool.query(
      `INSERT INTO inventory_items
         (workshop_id, name, part_number, category, unit,
          quantity, reorder_threshold, cost_price, selling_price,
          supplier_name, supplier_phone, location, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${SELECT_COLS}`,
      [
        workshopId, d.name, d.part_number ?? null, d.category ?? null, d.unit,
        d.quantity, d.reorder_threshold, d.cost_price, d.selling_price,
        d.supplier_name ?? null, d.supplier_phone ?? null,
        d.location ?? null, d.notes ?? null,
      ],
    );
    ok(res, rows[0], 201);
  } catch (err) {
    console.error('Create inventory item error:', err);
    fail(res, 500, 'Failed to create item');
  }
});

// ---------------------------------------------------------------------------
// PUT /api/inventory/:id
// ---------------------------------------------------------------------------

router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Item not found'); return; }

  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const d = parsed.data;
  const { workshopId } = req.user!;

  try {
    const { rows } = await pool.query(
      `UPDATE inventory_items SET
         name=$1, part_number=$2, category=$3, unit=$4,
         quantity=$5, reorder_threshold=$6, cost_price=$7, selling_price=$8,
         supplier_name=$9, supplier_phone=$10, location=$11, notes=$12,
         updated_at=NOW()
       WHERE id=$13 AND workshop_id=$14
       RETURNING ${SELECT_COLS}`,
      [
        d.name, d.part_number ?? null, d.category ?? null, d.unit,
        d.quantity, d.reorder_threshold, d.cost_price, d.selling_price,
        d.supplier_name ?? null, d.supplier_phone ?? null,
        d.location ?? null, d.notes ?? null,
        id, workshopId,
      ],
    );
    if (rows.length === 0) { fail(res, 404, 'Item not found'); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error('Update inventory item error:', err);
    fail(res, 500, 'Failed to update item');
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/inventory/:id
// ---------------------------------------------------------------------------

router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Item not found'); return; }

  const { workshopId } = req.user!;

  try {
    const linked = await pool.query(
      'SELECT COUNT(*) FROM work_order_items WHERE inventory_item_id = $1',
      [id],
    );
    if (parseInt(linked.rows[0].count, 10) > 0) {
      fail(res, 400, 'Part has been used in work orders. Deactivate instead.');
      return;
    }

    const { rows } = await pool.query(
      'DELETE FROM inventory_items WHERE id = $1 AND workshop_id = $2 RETURNING id',
      [id, workshopId],
    );
    if (rows.length === 0) { fail(res, 404, 'Item not found'); return; }
    ok(res, { id: rows[0].id });
  } catch (err) {
    console.error('Delete inventory item error:', err);
    fail(res, 500, 'Failed to delete item');
  }
});

// ---------------------------------------------------------------------------
// GET /api/inventory/:id/history
// ---------------------------------------------------------------------------

router.get('/:id/history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Item not found'); return; }

  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `SELECT
         sa.id,
         sa.quantity_change::float,
         sa.note,
         sa.reference_number,
         sa.created_at,
         u.name  AS adjusted_by_name,
         wo.id   AS work_order_id,
         wo.order_number AS work_order_number
       FROM stock_adjustments sa
       LEFT JOIN users        u  ON u.id  = sa.adjusted_by
       LEFT JOIN work_orders  wo ON wo.id = sa.work_order_id
       WHERE sa.inventory_item_id = $1
         AND sa.workshop_id = $2
       ORDER BY sa.created_at DESC`,
      [id, workshopId],
    );
    ok(res, rows);
  } catch (err) {
    console.error('Stock history error:', err);
    fail(res, 500, 'Failed to fetch history');
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/inventory/:id/adjust
// ---------------------------------------------------------------------------

const adjustSchema = z.object({
  quantityChange:  z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.number({ error: 'Quantity change is required' }),
  ).refine((v) => v !== 0, 'Quantity change cannot be zero'),
  note:            z.string().min(1, 'Note is required'),
  referenceNumber: z.string().optional().nullable(),
  // Supplier / delivery fields (saved when receiving stock)
  supplierName:    z.string().optional().nullable(),
  supplierPhone:   z.string().optional().nullable(),
  supplierInvoice: z.string().optional().nullable(),
  unitCost:        z.preprocess(
    (v) => (v === '' || v == null ? null : Number(v)),
    z.number().nonnegative().nullable().optional(),
  ),
  batchNote:       z.string().optional().nullable(),
});

router.patch('/:id/adjust', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Item not found'); return; }

  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Validation failed';
    fail(res, 400, first);
    return;
  }

  const { quantityChange, note, referenceNumber, supplierName, supplierPhone, supplierInvoice, unitCost, batchNote } = parsed.data;
  const { workshopId, userId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch current quantity to validate negative adjustments
    if (quantityChange < 0) {
      const cur = await client.query(
        'SELECT quantity FROM inventory_items WHERE id = $1 AND workshop_id = $2',
        [id, workshopId],
      );
      if (cur.rows.length === 0) {
        await client.query('ROLLBACK');
        fail(res, 404, 'Item not found');
        return;
      }
      const resultQty = parseFloat(cur.rows[0].quantity) + quantityChange;
      if (resultQty < 0) {
        await client.query('ROLLBACK');
        fail(res, 400, `Cannot reduce below zero. Current quantity: ${cur.rows[0].quantity}`);
        return;
      }
    }

    const updated = await client.query(
      `UPDATE inventory_items
       SET quantity = quantity + $1, updated_at = NOW()
       WHERE id = $2 AND workshop_id = $3
       RETURNING ${SELECT_COLS}`,
      [quantityChange, id, workshopId],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Item not found');
      return;
    }

    await client.query(
      `INSERT INTO stock_adjustments
         (workshop_id, inventory_item_id, quantity_change, note, reference_number,
          supplier_name, supplier_phone, supplier_invoice, unit_cost, batch_note, adjusted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [workshopId, id, quantityChange, note, referenceNumber ?? null,
       supplierName ?? null, supplierPhone ?? null, supplierInvoice ?? null,
       unitCost ?? null, batchNote ?? null, userId],
    );

    await client.query('COMMIT');
    ok(res, updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Adjust stock error:', err);
    fail(res, 500, 'Failed to adjust stock');
  } finally {
    client.release();
  }
});

export default router;
