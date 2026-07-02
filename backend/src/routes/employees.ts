import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

const STAFF_ROLES = ['admin', 'service_advisor', 'technician'] as const;
type StaffRole = typeof STAFF_ROLES[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data, error: null });
}
function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ data: null, error: { message } });
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  const bytes = crypto.randomBytes(10);
  for (const b of bytes) pwd += chars[b % chars.length];
  return pwd;
}

// ---------------------------------------------------------------------------
// GET /api/employees
// Returns all staff (admin, service_advisor, technician) with lifetime stats
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.name, u.email, u.role, u.phone, u.active,
         COUNT(DISTINCT wo.id)::int                                               AS total_jobs,
         COUNT(DISTINCT wo.id) FILTER (
           WHERE wo.status NOT IN ('delivered','cancelled'))::int                 AS active_jobs,
         COUNT(DISTINCT wo.id) FILTER (
           WHERE wo.status = 'delivered')::int                                    AS completed_jobs,
         COALESCE(SUM(i.total) FILTER (WHERE i.status = 'paid'), 0)::float       AS lifetime_revenue,
         COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'paid')::int              AS paid_invoices
       FROM users u
       LEFT JOIN work_orders wo ON wo.assigned_to = u.id AND wo.workshop_id = $1
       LEFT JOIN invoices    i  ON i.work_order_id = wo.id
       WHERE u.workshop_id = $1
         AND u.role IN ('admin','service_advisor','technician')
       GROUP BY u.id, u.name, u.email, u.role, u.phone, u.active
       ORDER BY u.active DESC, lifetime_revenue DESC, u.name ASC`,
      [workshopId],
    );
    ok(res, rows);
  } catch (err) {
    console.error('List employees error:', err);
    fail(res, 500, 'Failed to fetch employees');
  }
});

// ---------------------------------------------------------------------------
// GET /api/employees/contribution?from=YYYY-MM-DD&to=YYYY-MM-DD
// Date-filtered contribution report
// ---------------------------------------------------------------------------

const contribSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.get('/contribution', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = contribSchema.safeParse(req.query);
  if (!parsed.success) { fail(res, 400, 'Invalid date parameters'); return; }

  const { workshopId } = req.user!;
  const now      = new Date();
  const toDate   = parsed.data.to   ?? now.toISOString().slice(0, 10);
  const fromDate = parsed.data.from ??
    new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);

  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.name, u.role, u.phone, u.active,
         COUNT(DISTINCT wo.id)::int                                               AS total_jobs,
         COUNT(DISTINCT wo.id) FILTER (
           WHERE wo.status = 'delivered')::int                                    AS completed_jobs,
         COUNT(DISTINCT wo.id) FILTER (
           WHERE wo.status NOT IN ('delivered','cancelled'))::int                 AS active_jobs,
         COALESCE(SUM(i.total) FILTER (WHERE i.status = 'paid'), 0)::float       AS paid_revenue,
         COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'paid')::int              AS paid_invoices,
         CASE
           WHEN COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'paid') > 0
           THEN (SUM(i.total) FILTER (WHERE i.status = 'paid') /
                 COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'paid'))::float
           ELSE 0
         END AS avg_invoice_value
       FROM users u
       LEFT JOIN work_orders wo
         ON  wo.assigned_to  = u.id
         AND wo.workshop_id  = $1
         AND wo.created_at::date >= $2::date
         AND wo.created_at::date <= $3::date
       LEFT JOIN invoices i ON i.work_order_id = wo.id
       WHERE u.workshop_id = $1
         AND u.role IN ('admin','service_advisor','technician')
       GROUP BY u.id, u.name, u.role, u.phone, u.active
       ORDER BY paid_revenue DESC, total_jobs DESC, u.name ASC`,
      [workshopId, fromDate, toDate],
    );

    const totalRevenue = rows.reduce((s, r) => s + (r.paid_revenue as number), 0);

    ok(res, { rows, meta: { from: fromDate, to: toDate, totalRevenue } });
  } catch (err) {
    console.error('Contribution report error:', err);
    fail(res, 500, 'Failed to generate contribution report');
  }
});

// ---------------------------------------------------------------------------
// POST /api/employees  — create a new staff member
// Returns { employee, temporaryPassword }
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name:  z.string().min(1),
  email: z.string().email(),
  role:  z.enum(STAFF_ROLES),
  phone: z.string().optional(),
});

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const { name, email, role, phone } = parsed.data;
  const tempPassword  = generatePassword();
  const passwordHash  = await bcrypt.hash(tempPassword, 10);

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (workshop_id, name, email, password_hash, role, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, role, phone, active`,
      [workshopId, name, email, passwordHash, role, phone ?? null],
    );
    ok(res, { employee: rows[0], temporaryPassword: tempPassword }, 201);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === '23505') {
      fail(res, 409, 'A user with this email already exists in this workshop');
      return;
    }
    console.error('Create employee error:', err);
    fail(res, 500, 'Failed to create employee');
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/employees/:id  — update name / phone / role / active
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  name:   z.string().min(1).optional(),
  phone:  z.string().optional(),
  role:   z.enum(STAFF_ROLES).optional(),
  active: z.boolean().optional(),
});

router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Employee not found'); return; }

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

  set('name',   d.name);
  set('phone',  d.phone);
  set('role',   d.role);
  set('active', d.active);

  if (fields.length === 0) { fail(res, 400, 'Nothing to update'); return; }

  try {
    const { rows } = await pool.query(
      `UPDATE users
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE workshop_id = $1 AND id = $2
         AND role IN ('admin','service_advisor','technician')
       RETURNING id, name, email, role, phone, active`,
      values,
    );
    if (rows.length === 0) { fail(res, 404, 'Employee not found'); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error('Update employee error:', err);
    fail(res, 500, 'Failed to update employee');
  }
});

// ---------------------------------------------------------------------------
// POST /api/employees/:id/reset-password  — generate new temp password
// ---------------------------------------------------------------------------

router.post('/:id/reset-password', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Employee not found'); return; }

  const { workshopId } = req.user!;
  const tempPassword = generatePassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  try {
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW()
       WHERE workshop_id = $2 AND id = $3
         AND role IN ('admin','service_advisor','technician')
       RETURNING id, name`,
      [passwordHash, workshopId, id],
    );
    if (rows.length === 0) { fail(res, 404, 'Employee not found'); return; }
    ok(res, { name: rows[0].name, temporaryPassword: tempPassword });
  } catch (err) {
    console.error('Reset password error:', err);
    fail(res, 500, 'Failed to reset password');
  }
});

export default router;
