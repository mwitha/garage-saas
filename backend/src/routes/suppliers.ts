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
// GET /api/suppliers
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `SELECT
         s.id, s.name, s.phone, s.email, s.address, s.notes, s.active,
         s.created_at, s.updated_at,
         COUNT(DISTINCT ii.id)::int  AS item_count,
         COUNT(DISTINCT g.id)::int   AS grn_count
       FROM suppliers s
       LEFT JOIN inventory_items ii ON ii.supplier_name = s.name AND ii.workshop_id = s.workshop_id
       LEFT JOIN grns g ON g.supplier_id = s.id
       WHERE s.workshop_id = $1
       GROUP BY s.id
       ORDER BY s.active DESC, s.name ASC`,
      [workshopId],
    );
    ok(res, rows);
  } catch (err) {
    console.error('List suppliers error:', err);
    fail(res, 500, 'Failed to fetch suppliers');
  }
});

// ---------------------------------------------------------------------------
// POST /api/suppliers
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name:    z.string().min(1),
  phone:   z.string().optional(),
  email:   z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  notes:   z.string().optional(),
});

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const { name, phone, email, address, notes } = parsed.data;
  try {
    const { rows } = await pool.query(
      `INSERT INTO suppliers (workshop_id, name, phone, email, address, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, phone, email, address, notes, active, created_at`,
      [workshopId, name, phone ?? null, email || null, address ?? null, notes ?? null],
    );
    ok(res, rows[0], 201);
  } catch (err) {
    console.error('Create supplier error:', err);
    fail(res, 500, 'Failed to create supplier');
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/suppliers/:id
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  name:    z.string().min(1).optional(),
  phone:   z.string().optional(),
  email:   z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  notes:   z.string().optional(),
  active:  z.boolean().optional(),
});

router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Supplier not found'); return; }

  const { workshopId } = req.user!;
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const d = parsed.data;
  const fields: string[] = [];
  const values: unknown[] = [workshopId, id];

  const set = (col: string, val: unknown) => {
    if (val === undefined) return;
    values.push(val === '' ? null : val);
    fields.push(`${col} = $${values.length}`);
  };

  set('name',    d.name);
  set('phone',   d.phone);
  set('email',   d.email);
  set('address', d.address);
  set('notes',   d.notes);
  set('active',  d.active);

  if (fields.length === 0) { fail(res, 400, 'Nothing to update'); return; }

  try {
    const { rows } = await pool.query(
      `UPDATE suppliers SET ${fields.join(', ')}, updated_at = NOW()
       WHERE workshop_id = $1 AND id = $2
       RETURNING id, name, phone, email, address, notes, active`,
      values,
    );
    if (rows.length === 0) { fail(res, 404, 'Supplier not found'); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error('Update supplier error:', err);
    fail(res, 500, 'Failed to update supplier');
  }
});

export default router;
