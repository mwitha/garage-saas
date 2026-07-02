import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db/pool';

const router = Router();

const registerSchema = z.object({
  workshopName: z.string().min(1),
  ownerName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  workshopId: z.string().uuid().optional(),
});

function signToken(userId: string, workshopId: string, role: string): string {
  return jwt.sign(
    { sub: userId, workshopId, role },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  );
}

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ message: 'Validation failed', errors: result.error.flatten() });
    return;
  }

  const { workshopName, ownerName, email, password, phone, city, address } = result.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM workshops WHERE owner_email = $1',
      [email]
    );
    if ((existing.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ message: 'An account with this email already exists' });
      return;
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const workshopResult = await client.query(
      `INSERT INTO workshops (name, owner_email, phone, city, address, trial_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name`,
      [workshopName, email, phone ?? null, city ?? null, address ?? null, trialEndsAt]
    );
    const workshop = workshopResult.rows[0];

    const passwordHash = await bcrypt.hash(password, 12);

    const userResult = await client.query(
      `INSERT INTO users (workshop_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'owner')
       RETURNING id, name, email, role`,
      [workshop.id, ownerName, email, passwordHash]
    );
    const user = userResult.rows[0];

    await client.query('COMMIT');

    const token = signToken(user.id, workshop.id, user.role);
    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      workshop: { id: workshop.id, name: workshop.name },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Register error:', err);
    res.status(500).json({ message: 'Registration failed' });
  } finally {
    client.release();
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ message: 'Validation failed', errors: result.error.flatten() });
    return;
  }

  const { email, password, workshopId } = result.data;

  try {
    const query = workshopId
      ? `SELECT u.id, u.name, u.email, u.role, u.password_hash, u.workshop_id,
                w.name AS workshop_name
         FROM users u
         JOIN workshops w ON w.id = u.workshop_id
         WHERE u.email = $1 AND u.workshop_id = $2 AND u.active = true AND w.active = true`
      : `SELECT u.id, u.name, u.email, u.role, u.password_hash, u.workshop_id,
                w.name AS workshop_name
         FROM users u
         JOIN workshops w ON w.id = u.workshop_id
         WHERE u.email = $1 AND u.active = true AND w.active = true`;

    const params = workshopId ? [email, workshopId] : [email];
    const { rows } = await pool.query(query, params);

    if (rows.length === 0) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    // Same email across multiple workshops — client must specify workshopId
    if (rows.length > 1) {
      res.status(409).json({
        message: 'Multiple accounts found. Please provide workshopId.',
        workshopIds: rows.map((r: { workshop_id: string }) => r.workshop_id),
      });
      return;
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const permRes = user.role === 'owner'
      ? { rows: [] }
      : await pool.query('SELECT section FROM user_permissions WHERE user_id = $1', [user.id]);
    const permissions: string[] = permRes.rows.map((r: { section: string }) => r.section);

    const token = signToken(user.id, user.workshop_id, user.role);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      workshop: { id: user.workshop_id, name: user.workshop_name },
      permissions,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

export default router;
