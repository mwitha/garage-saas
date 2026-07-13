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
// GET /api/issue-notes — list with item count
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
  const conditions: string[] = ['n.workshop_id = $1'];
  if (status) {
    params.push(status);
    conditions.push(`n.status = $${params.length}`);
  }
  const where = conditions.join(' AND ');

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM issue_notes n WHERE ${where}`, params),
      pool.query(
        `SELECT
           n.id, n.issue_number, n.issued_to, n.reason, n.issued_at,
           n.status, n.created_at, n.posted_at,
           COUNT(ni.id)::int AS item_count
         FROM issue_notes n
         LEFT JOIN issue_note_items ni ON ni.issue_note_id = n.id
         WHERE ${where}
         GROUP BY n.id
         ORDER BY n.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    ok(res, {
      issueNotes: dataRes.rows,
      total: parseInt(countRes.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('List issue notes error:', err);
    fail(res, 500, 'Failed to fetch issue notes');
  }
});

// ---------------------------------------------------------------------------
// GET /api/issue-notes/:id
// ---------------------------------------------------------------------------

router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Issue note not found'); return; }

  const { workshopId } = req.user!;
  try {
    const [noteRes, itemsRes] = await Promise.all([
      pool.query(
        `SELECT id, issue_number, issued_to, reason, issued_at,
                status, created_at, posted_at
         FROM issue_notes WHERE id = $1 AND workshop_id = $2`,
        [id, workshopId],
      ),
      pool.query(
        `SELECT
           ni.id, ni.inventory_item_id, ni.quantity::float,
           ii.name AS item_name, ii.part_number, ii.unit
         FROM issue_note_items ni
         JOIN inventory_items ii ON ii.id = ni.inventory_item_id
         WHERE ni.issue_note_id = $1
         ORDER BY ni.id ASC`,
        [id],
      ),
    ]);
    if (noteRes.rows.length === 0) { fail(res, 404, 'Issue note not found'); return; }
    ok(res, { ...noteRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    console.error('Get issue note error:', err);
    fail(res, 500, 'Failed to fetch issue note');
  }
});

// ---------------------------------------------------------------------------
// POST /api/issue-notes — create draft with items
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  inventory_item_id: z.string().uuid(),
  quantity:          z.number().positive(),
});

const createSchema = z.object({
  issued_to: z.string().min(1, 'Issued to is required'),
  reason:    z.string().optional(),
  issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items:     z.array(itemSchema).min(1, 'At least one item is required'),
});

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId, userId } = req.user!;
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Validation failed';
    fail(res, 400, msg);
    return;
  }

  const { issued_to, reason, issued_at, items } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const counterRes = await client.query(
      `UPDATE workshops
       SET issue_note_counter = issue_note_counter + 1
       WHERE id = $1
       RETURNING issue_note_counter`,
      [workshopId],
    );
    const issueNumber = `ISS-${String(counterRes.rows[0].issue_note_counter).padStart(5, '0')}`;

    const noteRes = await client.query(
      `INSERT INTO issue_notes
         (workshop_id, issue_number, issued_to, reason, issued_at, status, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),'draft',$6)
       RETURNING id, issue_number, status, created_at`,
      [workshopId, issueNumber, issued_to, reason ?? null, issued_at ?? null, userId],
    );
    const note = noteRes.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO issue_note_items (issue_note_id, inventory_item_id, quantity)
         VALUES ($1,$2,$3)`,
        [note.id, item.inventory_item_id, item.quantity],
      );
    }

    await client.query('COMMIT');
    ok(res, note, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create issue note error:', err);
    fail(res, 500, 'Failed to create issue note');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/issue-notes/:id — update draft header + items (full replace)
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  issued_to: z.string().min(1).optional(),
  reason:    z.string().optional(),
  issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items:     z.array(itemSchema).min(1).optional(),
});

router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Issue note not found'); return; }

  const { workshopId } = req.user!;
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const check = await client.query(
      'SELECT status FROM issue_notes WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if (check.rows.length === 0) { await client.query('ROLLBACK'); fail(res, 404, 'Issue note not found'); return; }
    if (check.rows[0].status === 'posted') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Cannot edit a posted issue note');
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

    set('issued_to', d.issued_to);
    set('reason',    d.reason);
    set('issued_at', d.issued_at);

    if (d.items) {
      await client.query('DELETE FROM issue_note_items WHERE issue_note_id = $1', [id]);
      for (const item of d.items) {
        await client.query(
          `INSERT INTO issue_note_items (issue_note_id, inventory_item_id, quantity)
           VALUES ($1,$2,$3)`,
          [id, item.inventory_item_id, item.quantity],
        );
      }
    }

    if (fields.length > 0) {
      await client.query(
        `UPDATE issue_notes SET ${fields.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND workshop_id = $2`,
        values,
      );
    }

    await client.query('COMMIT');

    const [noteRes, itemsRes] = await Promise.all([
      pool.query(
        `SELECT id, issue_number, issued_to, reason, issued_at, status, created_at
         FROM issue_notes WHERE id = $1`,
        [id],
      ),
      pool.query(
        `SELECT ni.id, ni.inventory_item_id, ni.quantity::float,
                ii.name AS item_name, ii.part_number, ii.unit
         FROM issue_note_items ni JOIN inventory_items ii ON ii.id = ni.inventory_item_id
         WHERE ni.issue_note_id = $1 ORDER BY ni.id`,
        [id],
      ),
    ]);
    ok(res, { ...noteRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update issue note error:', err);
    fail(res, 500, 'Failed to update issue note');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /api/issue-notes/:id/post — finalise, deduct stock
// ---------------------------------------------------------------------------

router.post('/:id/post', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Issue note not found'); return; }

  const { workshopId, userId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const noteRes = await client.query(
      `SELECT id, issue_number, issued_to, status
       FROM issue_notes WHERE id = $1 AND workshop_id = $2 FOR UPDATE`,
      [id, workshopId],
    );
    if (noteRes.rows.length === 0) { await client.query('ROLLBACK'); fail(res, 404, 'Issue note not found'); return; }
    if (noteRes.rows[0].status === 'posted') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Issue note is already posted');
      return;
    }
    const note = noteRes.rows[0];

    const itemsRes = await client.query(
      `SELECT ni.inventory_item_id, ni.quantity::float, ii.name, ii.quantity::float AS stock_qty
       FROM issue_note_items ni
       JOIN inventory_items ii ON ii.id = ni.inventory_item_id
       WHERE ni.issue_note_id = $1
       FOR UPDATE OF ii`,
      [id],
    );

    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 400, 'Issue note has no items');
      return;
    }

    for (const item of itemsRes.rows) {
      if (item.stock_qty < item.quantity) {
        await client.query('ROLLBACK');
        fail(res, 422, `Insufficient stock for ${item.name}: ${item.stock_qty} available, ${item.quantity} requested`);
        return;
      }
    }

    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE inventory_items
         SET quantity = quantity - $1, updated_at = NOW()
         WHERE id = $2 AND workshop_id = $3`,
        [item.quantity, item.inventory_item_id, workshopId],
      );

      await client.query(
        `INSERT INTO stock_adjustments
           (workshop_id, inventory_item_id, quantity_change, note,
            reference_number, issue_note_id, adjusted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          workshopId, item.inventory_item_id, -item.quantity,
          `Issued: ${note.issue_number} — ${note.issued_to}`,
          note.issue_number,
          id,
          userId,
        ],
      );
    }

    const finalRes = await client.query(
      `UPDATE issue_notes
       SET status = 'posted', posted_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, issue_number, status, posted_at`,
      [id],
    );

    await client.query('COMMIT');
    ok(res, finalRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Post issue note error:', err);
    fail(res, 500, 'Failed to post issue note');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/issue-notes/:id — delete draft only
// ---------------------------------------------------------------------------

router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Issue note not found'); return; }

  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `DELETE FROM issue_notes WHERE id = $1 AND workshop_id = $2 AND status = 'draft'
       RETURNING id`,
      [id, workshopId],
    );
    if (rows.length === 0) {
      fail(res, 404, 'Draft issue note not found (posted notes cannot be deleted)');
      return;
    }
    ok(res, { id: rows[0].id });
  } catch (err) {
    console.error('Delete issue note error:', err);
    fail(res, 500, 'Failed to delete issue note');
  }
});

export default router;
