import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data, error: null });
}
function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ data: null, error: { message } });
}

// ---------------------------------------------------------------------------
// GET /api/grns  — list with supplier name and item count
// ---------------------------------------------------------------------------

const listSchema = z.object({
  status: z.enum(['draft', 'posted']).optional(),
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
});

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) { fail(res, 400, 'Invalid query'); return; }

  const { status, page, limit } = parsed.data;
  const { workshopId } = req.user!;
  const offset = (page - 1) * limit;

  const params: unknown[] = [workshopId];
  const conditions: string[] = ['g.workshop_id = $1'];
  if (status) {
    params.push(status);
    conditions.push(`g.status = $${params.length}`);
  }
  const where = conditions.join(' AND ');

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM grns g WHERE ${where}`, params),
      pool.query(
        `SELECT
           g.id, g.grn_number, g.status, g.supplier_invoice,
           g.received_at, g.total_cost::float, g.notes, g.created_at, g.posted_at,
           s.id AS supplier_id, s.name AS supplier_name,
           COUNT(gi.id)::int AS item_count
         FROM grns g
         LEFT JOIN suppliers s  ON s.id = g.supplier_id
         LEFT JOIN grn_items gi ON gi.grn_id = g.id
         WHERE ${where}
         GROUP BY g.id, s.id, s.name
         ORDER BY g.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    ok(res, {
      grns: dataRes.rows,
      total: parseInt(countRes.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('List GRNs error:', err);
    fail(res, 500, 'Failed to fetch GRNs');
  }
});

// ---------------------------------------------------------------------------
// GET /api/grns/:id
// ---------------------------------------------------------------------------

router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'GRN not found'); return; }

  const { workshopId } = req.user!;
  try {
    const [grnRes, itemsRes] = await Promise.all([
      pool.query(
        `SELECT
           g.id, g.grn_number, g.status, g.supplier_invoice,
           g.received_at, g.total_cost::float, g.notes, g.created_at, g.posted_at,
           s.id AS supplier_id, s.name AS supplier_name, s.phone AS supplier_phone
         FROM grns g
         LEFT JOIN suppliers s ON s.id = g.supplier_id
         WHERE g.id = $1 AND g.workshop_id = $2`,
        [id, workshopId],
      ),
      pool.query(
        `SELECT
           gi.id, gi.inventory_item_id,
           gi.quantity::float, gi.unit_cost::float, gi.line_total::float,
           ii.name AS item_name, ii.part_number, ii.unit
         FROM grn_items gi
         JOIN inventory_items ii ON ii.id = gi.inventory_item_id
         WHERE gi.grn_id = $1
         ORDER BY gi.id ASC`,
        [id],
      ),
    ]);
    if (grnRes.rows.length === 0) { fail(res, 404, 'GRN not found'); return; }
    ok(res, { ...grnRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    console.error('Get GRN error:', err);
    fail(res, 500, 'Failed to fetch GRN');
  }
});

// ---------------------------------------------------------------------------
// POST /api/grns  — create draft GRN with items
// ---------------------------------------------------------------------------

const grnItemSchema = z.object({
  inventory_item_id: z.string().uuid(),
  quantity:          z.number().positive(),
  unit_cost:         z.number().nonnegative().default(0),
});

const createSchema = z.object({
  supplier_id:      z.string().uuid().optional().nullable(),
  supplier_invoice: z.string().optional(),
  received_at:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:            z.string().optional(),
  items:            z.array(grnItemSchema).min(1, 'At least one item is required'),
});

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId, userId } = req.user!;
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Validation failed';
    fail(res, 400, msg);
    return;
  }

  const { supplier_id, supplier_invoice, received_at, notes, items } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Increment GRN counter and get prefix (reuse workshops table pattern)
    const counterRes = await client.query(
      `UPDATE workshops
       SET grn_counter = grn_counter + 1
       WHERE id = $1
       RETURNING grn_counter`,
      [workshopId],
    );
    const grnNumber = `GRN-${String(counterRes.rows[0].grn_counter).padStart(5, '0')}`;

    const totalCost = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);

    const grnRes = await client.query(
      `INSERT INTO grns
         (workshop_id, supplier_id, grn_number, supplier_invoice,
          received_at, notes, status, total_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8)
       RETURNING id, grn_number, status, total_cost::float, created_at`,
      [
        workshopId, supplier_id ?? null, grnNumber,
        supplier_invoice ?? null, received_at ?? null,
        notes ?? null, totalCost, userId,
      ],
    );
    const grn = grnRes.rows[0];

    // Insert line items
    for (const item of items) {
      await client.query(
        `INSERT INTO grn_items (grn_id, inventory_item_id, quantity, unit_cost)
         VALUES ($1,$2,$3,$4)`,
        [grn.id, item.inventory_item_id, item.quantity, item.unit_cost],
      );
    }

    await client.query('COMMIT');
    ok(res, grn, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create GRN error:', err);
    fail(res, 500, 'Failed to create GRN');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/grns/:id  — update draft GRN header + items (full replace of items)
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  supplier_id:      z.string().uuid().optional().nullable(),
  supplier_invoice: z.string().optional(),
  received_at:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:            z.string().optional(),
  items:            z.array(grnItemSchema).min(1).optional(),
});

router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'GRN not found'); return; }

  const { workshopId } = req.user!;
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const check = await client.query(
      'SELECT status FROM grns WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if (check.rows.length === 0) { await client.query('ROLLBACK'); fail(res, 404, 'GRN not found'); return; }
    if (check.rows[0].status === 'posted') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Cannot edit a posted GRN');
      return;
    }

    const d = parsed.data;
    const fields: string[] = [];
    const values: unknown[] = [id, workshopId];

    const set = (col: string, val: unknown) => {
      if (val === undefined) return;
      values.push(val === '' ? null : val);
      fields.push(`${col} = $${values.length}`);
    };

    set('supplier_id',      d.supplier_id);
    set('supplier_invoice', d.supplier_invoice);
    set('received_at',      d.received_at);
    set('notes',            d.notes);

    if (d.items) {
      const totalCost = d.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
      values.push(totalCost);
      fields.push(`total_cost = $${values.length}`);

      // Full replace of items
      await client.query('DELETE FROM grn_items WHERE grn_id = $1', [id]);
      for (const item of d.items) {
        await client.query(
          `INSERT INTO grn_items (grn_id, inventory_item_id, quantity, unit_cost)
           VALUES ($1,$2,$3,$4)`,
          [id, item.inventory_item_id, item.quantity, item.unit_cost],
        );
      }
    }

    if (fields.length > 0) {
      await client.query(
        `UPDATE grns SET ${fields.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND workshop_id = $2`,
        values,
      );
    }

    await client.query('COMMIT');

    // Return updated GRN
    const [grnRes, itemsRes] = await Promise.all([
      pool.query(
        `SELECT g.id, g.grn_number, g.status, g.supplier_invoice,
                g.received_at, g.total_cost::float, g.notes,
                s.id AS supplier_id, s.name AS supplier_name
         FROM grns g LEFT JOIN suppliers s ON s.id = g.supplier_id
         WHERE g.id = $1`,
        [id],
      ),
      pool.query(
        `SELECT gi.id, gi.inventory_item_id,
                gi.quantity::float, gi.unit_cost::float, gi.line_total::float,
                ii.name AS item_name, ii.part_number, ii.unit
         FROM grn_items gi JOIN inventory_items ii ON ii.id = gi.inventory_item_id
         WHERE gi.grn_id = $1 ORDER BY gi.id`,
        [id],
      ),
    ]);
    ok(res, { ...grnRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update GRN error:', err);
    fail(res, 500, 'Failed to update GRN');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /api/grns/:id/post  — finalise GRN, update stock
// ---------------------------------------------------------------------------

router.post('/:id/post', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'GRN not found'); return; }

  const { workshopId, userId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const grnRes = await client.query(
      `SELECT g.id, g.grn_number, g.status, g.supplier_invoice,
              s.name AS supplier_name, s.phone AS supplier_phone
       FROM grns g
       LEFT JOIN suppliers s ON s.id = g.supplier_id
       WHERE g.id = $1 AND g.workshop_id = $2
       FOR UPDATE`,
      [id, workshopId],
    );

    if (grnRes.rows.length === 0) { await client.query('ROLLBACK'); fail(res, 404, 'GRN not found'); return; }
    if (grnRes.rows[0].status === 'posted') {
      await client.query('ROLLBACK');
      fail(res, 409, 'GRN is already posted');
      return;
    }

    const grn = grnRes.rows[0];

    const itemsRes = await client.query(
      `SELECT gi.inventory_item_id, gi.quantity::float, gi.unit_cost::float, ii.name
       FROM grn_items gi
       JOIN inventory_items ii ON ii.id = gi.inventory_item_id
       WHERE gi.grn_id = $1`,
      [id],
    );

    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 400, 'GRN has no items');
      return;
    }

    // Update stock and create adjustment records for each item
    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE inventory_items
         SET quantity = quantity + $1, updated_at = NOW()
         WHERE id = $2 AND workshop_id = $3`,
        [item.quantity, item.inventory_item_id, workshopId],
      );

      await client.query(
        `INSERT INTO stock_adjustments
           (workshop_id, inventory_item_id, quantity_change, note,
            reference_number, supplier_name, supplier_phone,
            supplier_invoice, unit_cost, grn_id, adjusted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          workshopId, item.inventory_item_id, item.quantity,
          `GRN received: ${grn.grn_number}`,
          grn.grn_number,
          grn.supplier_name ?? null,
          grn.supplier_phone ?? null,
          grn.supplier_invoice ?? null,
          item.unit_cost,
          id,
          userId,
        ],
      );
    }

    // Mark GRN as posted
    const totalRes = await client.query(
      `UPDATE grns
       SET status = 'posted', posted_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, grn_number, status, total_cost::float, posted_at`,
      [id],
    );

    await client.query('COMMIT');
    ok(res, totalRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Post GRN error:', err);
    fail(res, 500, 'Failed to post GRN');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/grns/:id  — delete draft only
// ---------------------------------------------------------------------------

router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'GRN not found'); return; }

  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `DELETE FROM grns WHERE id = $1 AND workshop_id = $2 AND status = 'draft'
       RETURNING id`,
      [id, workshopId],
    );
    if (rows.length === 0) {
      fail(res, 404, 'Draft GRN not found (posted GRNs cannot be deleted)');
      return;
    }
    ok(res, { id: rows[0].id });
  } catch (err) {
    console.error('Delete GRN error:', err);
    fail(res, 500, 'Failed to delete GRN');
  }
});

export default router;
