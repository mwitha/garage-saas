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
  search:          z.string().optional(),
  category:        z.string().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  page:            z.coerce.number().int().positive().default(1),
  limit:           z.coerce.number().int().positive().max(100).default(50),
});

const itemSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional().nullable(),
  category:    z.string().optional().nullable(),
  price:       z.preprocess((v) => Number(v ?? 0), z.number().nonnegative()),
  active:      z.boolean().optional().default(true),
});

// ---------------------------------------------------------------------------
// Shared SELECT columns
// ---------------------------------------------------------------------------

const SELECT_COLS = `
  id, name, description, category, price::float, active,
  created_at, updated_at`;

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
// GET /api/service-items
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) { fail(res, 400, 'Invalid query parameters'); return; }

  const { search, category, includeInactive, page, limit } = parsed.data;
  const { workshopId } = req.user!;
  const offset = (page - 1) * limit;

  const params: unknown[] = [workshopId];
  const conditions: string[] = ['workshop_id = $1'];

  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  if (category?.trim()) {
    params.push(category.trim());
    conditions.push(`category = $${params.length}`);
  }
  if (includeInactive !== 'true') {
    conditions.push('active = true');
  }

  const where = conditions.join(' AND ');

  try {
    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM service_items WHERE ${where}`, params),
      pool.query(
        `SELECT ${SELECT_COLS}
         FROM service_items
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
    console.error('List service items error:', err);
    fail(res, 500, 'Failed to fetch service items');
  }
});

// ---------------------------------------------------------------------------
// GET /api/service-items/:id
// ---------------------------------------------------------------------------

router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Service not found'); return; }

  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLS} FROM service_items WHERE id = $1 AND workshop_id = $2`,
      [id, workshopId],
    );
    if (rows.length === 0) { fail(res, 404, 'Service not found'); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error('Get service item error:', err);
    fail(res, 500, 'Failed to fetch service');
  }
});

// ---------------------------------------------------------------------------
// POST /api/service-items
// ---------------------------------------------------------------------------

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const d = parsed.data;
  const { workshopId } = req.user!;

  try {
    const { rows } = await pool.query(
      `INSERT INTO service_items (workshop_id, name, description, category, price, active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${SELECT_COLS}`,
      [workshopId, d.name, d.description ?? null, d.category ?? null, d.price, d.active],
    );
    ok(res, rows[0], 201);
  } catch (err) {
    console.error('Create service item error:', err);
    fail(res, 500, 'Failed to create service');
  }
});

// ---------------------------------------------------------------------------
// PUT /api/service-items/:id
// ---------------------------------------------------------------------------

router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Service not found'); return; }

  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const d = parsed.data;
  const { workshopId } = req.user!;

  try {
    const { rows } = await pool.query(
      `UPDATE service_items SET
         name=$1, description=$2, category=$3, price=$4, active=$5, updated_at=NOW()
       WHERE id=$6 AND workshop_id=$7
       RETURNING ${SELECT_COLS}`,
      [d.name, d.description ?? null, d.category ?? null, d.price, d.active, id, workshopId],
    );
    if (rows.length === 0) { fail(res, 404, 'Service not found'); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error('Update service item error:', err);
    fail(res, 500, 'Failed to update service');
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/service-items/:id
// ---------------------------------------------------------------------------

router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Service not found'); return; }

  const { workshopId } = req.user!;

  try {
    const linked = await pool.query(
      'SELECT COUNT(*) FROM work_order_items WHERE service_item_id = $1',
      [id],
    );
    if (parseInt(linked.rows[0].count, 10) > 0) {
      fail(res, 400, 'Service has been used in work orders. Deactivate instead.');
      return;
    }

    const { rows } = await pool.query(
      'DELETE FROM service_items WHERE id = $1 AND workshop_id = $2 RETURNING id',
      [id, workshopId],
    );
    if (rows.length === 0) { fail(res, 404, 'Service not found'); return; }
    ok(res, { id: rows[0].id });
  } catch (err) {
    console.error('Delete service item error:', err);
    fail(res, 500, 'Failed to delete service');
  }
});

export default router;
