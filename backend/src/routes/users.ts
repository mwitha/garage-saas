import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// GET /api/users — list active users in this workshop (for technician dropdowns)
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, phone
       FROM users
       WHERE workshop_id = $1 AND active = true
       ORDER BY name ASC`,
      [workshopId],
    );
    res.status(200).json({ data: rows, error: null });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ data: null, error: { message: 'Failed to fetch users' } });
  }
});

export default router;
