import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALL_SECTIONS = [
  'customers', 'work_orders', 'invoices', 'inventory',
  'reports', 'employees', 'suppliers', 'settings', 'expenses',
] as const;

function ok(res: Response, data: unknown): void {
  res.json({ data, error: null });
}
function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ data: null, error: { message } });
}

// ---------------------------------------------------------------------------
// GET /api/permissions
// Returns all non-owner staff with their current permissions (for the matrix UI)
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId, role } = req.user!;

  if (role !== 'owner' && role !== 'admin') {
    fail(res, 403, 'Only owner or admin can view permissions');
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.name, u.email, u.role, u.active,
         COALESCE(
           ARRAY_AGG(up.section ORDER BY up.section) FILTER (WHERE up.section IS NOT NULL),
           '{}'::text[]
         ) AS permissions
       FROM users u
       LEFT JOIN user_permissions up ON up.user_id = u.id
       WHERE u.workshop_id = $1
         AND u.role IN ('admin','service_advisor','technician')
       GROUP BY u.id, u.name, u.email, u.role, u.active
       ORDER BY u.role, u.name`,
      [workshopId],
    );
    ok(res, rows);
  } catch (err) {
    console.error('Get all permissions error:', err);
    fail(res, 500, 'Failed to fetch permissions');
  }
});

// ---------------------------------------------------------------------------
// GET /api/permissions/:userId
// ---------------------------------------------------------------------------

router.get('/:userId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { userId: requestingUserId, workshopId, role } = req.user!;
  const targetId = req.params.userId as string;
  if (!UUID_RE.test(targetId)) { fail(res, 404, 'User not found'); return; }

  // Users can view their own permissions; owner/admin can view anyone's
  if (targetId !== requestingUserId && role !== 'owner' && role !== 'admin') {
    fail(res, 403, 'Access denied');
    return;
  }

  try {
    const [userRes, permRes] = await Promise.all([
      pool.query(
        'SELECT id, name, email, role, active FROM users WHERE id = $1 AND workshop_id = $2',
        [targetId, workshopId],
      ),
      pool.query(
        'SELECT section FROM user_permissions WHERE user_id = $1 ORDER BY section',
        [targetId],
      ),
    ]);

    if (userRes.rows.length === 0) { fail(res, 404, 'User not found'); return; }

    ok(res, {
      ...userRes.rows[0],
      permissions: permRes.rows.map((r: { section: string }) => r.section),
    });
  } catch (err) {
    console.error('Get user permissions error:', err);
    fail(res, 500, 'Failed to fetch permissions');
  }
});

// ---------------------------------------------------------------------------
// PUT /api/permissions/:userId
// Full replace: sets exactly the provided sections for the user
// Only owner can set admin permissions; owner/admin can set others
// ---------------------------------------------------------------------------

const putSchema = z.object({
  sections: z.array(z.enum(ALL_SECTIONS)),
});

router.put('/:userId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { userId: requestingUserId, workshopId, role: requestingRole } = req.user!;
  const targetId = req.params.userId as string;
  if (!UUID_RE.test(targetId)) { fail(res, 404, 'User not found'); return; }

  const parsed = putSchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Invalid sections'); return; }

  const { sections } = parsed.data;

  // Prevent self-permission editing (owner can't be restricted; others shouldn't self-escalate)
  if (targetId === requestingUserId && requestingRole !== 'owner') {
    fail(res, 403, 'You cannot edit your own permissions');
    return;
  }

  try {
    // Verify target user belongs to this workshop and get their role
    const targetRes = await pool.query(
      'SELECT id, role FROM users WHERE id = $1 AND workshop_id = $2',
      [targetId, workshopId],
    );
    if (targetRes.rows.length === 0) { fail(res, 404, 'User not found'); return; }

    const targetRole: string = targetRes.rows[0].role;

    if (targetRole === 'owner') {
      fail(res, 403, 'Cannot modify owner permissions');
      return;
    }
    if (targetRole === 'admin' && requestingRole !== 'owner') {
      fail(res, 403, 'Only the owner can modify admin permissions');
      return;
    }
    if (requestingRole !== 'owner' && requestingRole !== 'admin') {
      fail(res, 403, 'Only owner or admin can modify permissions');
      return;
    }

    // Full replace inside a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM user_permissions WHERE user_id = $1', [targetId]);
      if (sections.length > 0) {
        const placeholders = sections.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO user_permissions (user_id, section) VALUES ${placeholders}`,
          [targetId, ...sections],
        );
      }
      await client.query('COMMIT');

      ok(res, { userId: targetId, sections });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update permissions error:', err);
    fail(res, 500, 'Failed to update permissions');
  }
});

export default router;
