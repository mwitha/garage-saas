import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

function ok(res: Response, data: unknown): void {
  res.json({ data, error: null });
}
function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ data: null, error: { message } });
}

const ACCOUNT_TYPES = ['current', 'savings', 'fixed_deposit', 'other'] as const;

const bodySchema = z.object({
  bank_name:      z.string().min(1, 'Bank name is required'),
  branch_name:    z.string().optional(),
  account_name:   z.string().min(1, 'Account name is required'),
  account_number: z.string().min(1, 'Account number is required'),
  account_type:   z.enum(ACCOUNT_TYPES).default('current'),
  swift_code:     z.string().optional(),
  is_primary:     z.boolean().optional(),
  notes:          z.string().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/bank-accounts
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `SELECT id, bank_name, branch_name, account_name, account_number,
              account_type, swift_code, is_primary, notes, created_at
       FROM bank_accounts
       WHERE workshop_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [workshopId],
    );
    ok(res, rows);
  } catch (err) {
    console.error('List bank accounts error:', err);
    fail(res, 500, 'Failed to fetch bank accounts');
  }
});

// ---------------------------------------------------------------------------
// POST /api/bank-accounts
// ---------------------------------------------------------------------------

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Invalid input'); return; }

  const { bank_name, branch_name, account_name, account_number, account_type, swift_code, is_primary, notes } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // If new account is primary, clear existing primary
    if (is_primary) {
      await client.query(
        'UPDATE bank_accounts SET is_primary = false WHERE workshop_id = $1',
        [workshopId],
      );
    }

    const { rows } = await client.query(
      `INSERT INTO bank_accounts
         (workshop_id, bank_name, branch_name, account_name, account_number,
          account_type, swift_code, is_primary, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [workshopId, bank_name, branch_name ?? null, account_name, account_number,
       account_type, swift_code ?? null, is_primary ?? false, notes ?? null],
    );

    await client.query('COMMIT');
    ok(res, rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create bank account error:', err);
    fail(res, 500, 'Failed to create bank account');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/bank-accounts/:id
// ---------------------------------------------------------------------------

router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const { id } = req.params;

  const parsed = bodySchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Invalid input'); return; }

  const fields = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify ownership
    const check = await client.query(
      'SELECT id FROM bank_accounts WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if (check.rows.length === 0) { fail(res, 404, 'Bank account not found'); return; }

    // If setting as primary, clear others first
    if (fields.is_primary) {
      await client.query(
        'UPDATE bank_accounts SET is_primary = false WHERE workshop_id = $1 AND id != $2',
        [workshopId, id],
      );
    }

    const sets: string[]    = [];
    const params: unknown[] = [id, workshopId];
    let i = 3;

    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) { sets.push(`${key} = $${i++}`); params.push(val); }
    }
    if (sets.length === 0) { fail(res, 400, 'Nothing to update'); return; }
    sets.push('updated_at = NOW()');

    const { rows } = await client.query(
      `UPDATE bank_accounts SET ${sets.join(', ')}
       WHERE id = $1 AND workshop_id = $2 RETURNING *`,
      params,
    );

    await client.query('COMMIT');
    ok(res, rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update bank account error:', err);
    fail(res, 500, 'Failed to update bank account');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/bank-accounts/:id
// ---------------------------------------------------------------------------

router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const { id } = req.params;

  try {
    const { rowCount } = await pool.query(
      'DELETE FROM bank_accounts WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if ((rowCount ?? 0) === 0) { fail(res, 404, 'Bank account not found'); return; }
    ok(res, { deleted: true });
  } catch (err) {
    console.error('Delete bank account error:', err);
    fail(res, 500, 'Failed to delete bank account');
  }
});

export default router;
