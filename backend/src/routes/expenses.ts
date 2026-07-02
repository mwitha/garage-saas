import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

export const EXPENSE_CATEGORIES = [
  'Rent / Lease',
  'Utilities',
  'Salaries',
  'Spare Parts',
  'Equipment',
  'Marketing',
  'Insurance',
  'Vehicle Fuel',
  'Maintenance',
  'Office Supplies',
  'Other',
] as const;

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'card'] as const;

function ok(res: Response, data: unknown): void {
  res.json({ data, error: null });
}
function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ data: null, error: { message } });
}

const bodySchema = z.object({
  date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category:       z.enum(EXPENSE_CATEGORIES),
  description:    z.string().min(1),
  amount:         z.number().positive(),
  payment_method: z.enum(PAYMENT_METHODS).default('cash'),
  reference:      z.string().optional(),
  notes:          z.string().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/expenses/report  (must be before /:id)
// ---------------------------------------------------------------------------

router.get('/report', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const from = (req.query.from as string) || new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString().slice(0, 10);
  const to   = (req.query.to   as string) || new Date().toISOString().slice(0, 10);

  try {
    const [summaryRes, categoryRes, monthlyRes] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(amount), 0)::numeric AS total_amount,
           COUNT(*)::int                     AS total_count
         FROM expenses
         WHERE workshop_id = $1 AND date BETWEEN $2 AND $3`,
        [workshopId, from, to],
      ),
      pool.query(
        `SELECT
           category,
           COALESCE(SUM(amount), 0)::numeric AS total,
           COUNT(*)::int                     AS count
         FROM expenses
         WHERE workshop_id = $1 AND date BETWEEN $2 AND $3
         GROUP BY category
         ORDER BY total DESC`,
        [workshopId, from, to],
      ),
      pool.query(
        `SELECT
           TO_CHAR(date, 'YYYY-MM') AS month,
           COALESCE(SUM(amount), 0)::numeric AS total
         FROM expenses
         WHERE workshop_id = $1 AND date BETWEEN $2 AND $3
         GROUP BY month
         ORDER BY month`,
        [workshopId, from, to],
      ),
    ]);

    const { total_amount, total_count } = summaryRes.rows[0];
    const days = Math.max(1, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1);

    ok(res, {
      meta: {
        from,
        to,
        totalAmount: parseFloat(total_amount),
        totalCount:  total_count,
        dailyAvg:    parseFloat(total_amount) / days,
      },
      byCategory: categoryRes.rows.map((r) => ({
        category: r.category,
        total:    parseFloat(r.total),
        count:    r.count,
      })),
      byMonth: monthlyRes.rows.map((r) => ({
        month: r.month,
        total: parseFloat(r.total),
      })),
    });
  } catch (err) {
    console.error('Expenses report error:', err);
    fail(res, 500, 'Failed to fetch report');
  }
});

// ---------------------------------------------------------------------------
// GET /api/expenses
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;

  const from     = (req.query.from     as string) || '';
  const to       = (req.query.to       as string) || '';
  const category = (req.query.category as string) || '';
  const page     = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit    = 50;
  const offset   = (page - 1) * limit;

  const conditions: string[] = ['e.workshop_id = $1'];
  const params: unknown[]    = [workshopId];
  let i = 2;

  if (from)     { conditions.push(`e.date >= $${i++}`); params.push(from); }
  if (to)       { conditions.push(`e.date <= $${i++}`); params.push(to); }
  if (category) { conditions.push(`e.category = $${i++}`); params.push(category); }

  const where = conditions.join(' AND ');

  try {
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT
           e.id, e.date, e.category, e.description,
           e.amount, e.payment_method, e.reference, e.notes,
           e.created_at,
           u.name AS created_by_name
         FROM expenses e
         LEFT JOIN users u ON u.id = e.created_by
         WHERE ${where}
         ORDER BY e.date DESC, e.created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM expenses e WHERE ${where}`, params),
    ]);

    ok(res, {
      rows:  dataRes.rows.map((r) => ({ ...r, amount: parseFloat(r.amount) })),
      total: countRes.rows[0].total,
      page,
      pages: Math.ceil(countRes.rows[0].total / limit),
    });
  } catch (err) {
    console.error('List expenses error:', err);
    fail(res, 500, 'Failed to fetch expenses');
  }
});

// ---------------------------------------------------------------------------
// POST /api/expenses
// ---------------------------------------------------------------------------

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId, userId } = req.user!;
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Invalid input'); return; }

  const { date, category, description, amount, payment_method, reference, notes } = parsed.data;

  try {
    const { rows } = await pool.query(
      `INSERT INTO expenses
         (workshop_id, date, category, description, amount, payment_method, reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, date, category, description, amount, payment_method, reference, notes, created_at`,
      [workshopId, date, category, description, amount, payment_method, reference ?? null, notes ?? null, userId],
    );
    ok(res, { ...rows[0], amount: parseFloat(rows[0].amount) });
  } catch (err) {
    console.error('Create expense error:', err);
    fail(res, 500, 'Failed to create expense');
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/expenses/:id
// ---------------------------------------------------------------------------

router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const { id } = req.params;

  const parsed = bodySchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Invalid input'); return; }

  const fields = parsed.data;
  const sets: string[]   = [];
  const params: unknown[] = [workshopId, id];
  let i = 3;

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) { sets.push(`${key} = $${i++}`); params.push(val); }
  }
  if (sets.length === 0) { fail(res, 400, 'Nothing to update'); return; }
  sets.push(`updated_at = NOW()`);

  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET ${sets.join(', ')}
       WHERE workshop_id = $1 AND id = $2
       RETURNING id, date, category, description, amount, payment_method, reference, notes`,
      params,
    );
    if (rows.length === 0) { fail(res, 404, 'Expense not found'); return; }
    ok(res, { ...rows[0], amount: parseFloat(rows[0].amount) });
  } catch (err) {
    console.error('Update expense error:', err);
    fail(res, 500, 'Failed to update expense');
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/expenses/:id
// ---------------------------------------------------------------------------

router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const { id } = req.params;

  try {
    const { rowCount } = await pool.query(
      'DELETE FROM expenses WHERE workshop_id = $1 AND id = $2',
      [workshopId, id],
    );
    if ((rowCount ?? 0) === 0) { fail(res, 404, 'Expense not found'); return; }
    ok(res, { deleted: true });
  } catch (err) {
    console.error('Delete expense error:', err);
    fail(res, 500, 'Failed to delete expense');
  }
});

export default router;
