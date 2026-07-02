import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { checkPermission } from './checkPermission';

interface JwtPayload {
  sub: string;
  workshopId: string;
  role: string;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
    return;
  }

  // Owner bypasses all permission checks — don't load permissions from DB
  if (payload.role === 'owner') {
    req.user = { userId: payload.sub, workshopId: payload.workshopId, role: payload.role, permissions: [] };
    checkPermission(req, res, next);
    return;
  }

  // Load granular permissions for non-owner users
  try {
    const { rows } = await pool.query(
      'SELECT section FROM user_permissions WHERE user_id = $1',
      [payload.sub],
    );
    req.user = {
      userId: payload.sub,
      workshopId: payload.workshopId,
      role: payload.role,
      permissions: rows.map((r: { section: string }) => r.section),
    };
  } catch (err) {
    console.error('Failed to load user permissions:', err);
    req.user = { userId: payload.sub, workshopId: payload.workshopId, role: payload.role, permissions: [] };
  }

  checkPermission(req, res, next);
}
