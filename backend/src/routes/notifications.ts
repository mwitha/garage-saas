import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';
import {
  sendJobReadySMS,
  sendServiceReminderSMS,
  sendInvoiceEmail,
} from '../services/notifications';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ data, error: null });
}
function fail(res: Response, status: number, message: string) {
  res.status(status).json({ data: null, error: { message } });
}

const listQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  type:       z.string().optional(),
  channel:    z.enum(['sms', 'email', 'whatsapp']).optional(),
  status:     z.enum(['pending', 'sent', 'failed', 'cancelled']).optional(),
  page:       z.coerce.number().int().positive().default(1),
  limit:      z.coerce.number().int().positive().max(100).default(50),
});

// ---------------------------------------------------------------------------
// GET /api/notifications — paginated history for this workshop
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) { fail(res, 400, 'Invalid query parameters'); return; }

  const { customerId, type, channel, status, page, limit } = parsed.data;
  const { workshopId } = req.user!;
  const offset = (page - 1) * limit;

  const params: unknown[] = [workshopId];
  const conditions: string[] = ['n.workshop_id = $1'];

  if (customerId) {
    params.push(customerId);
    conditions.push(`n.customer_id = $${params.length}`);
  }
  if (type) {
    params.push(type);
    conditions.push(`n.type = $${params.length}`);
  }
  if (channel) {
    params.push(channel);
    conditions.push(`n.channel = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`n.status = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM notifications n WHERE ${where}`, params),
      pool.query(
        `SELECT
           n.id, n.type, n.channel, n.status,
           n.recipient, n.message, n.external_id, n.error_message,
           n.sent_at, n.created_at,
           n.work_order_id,
           c.name AS customer_name,
           c.phone AS customer_phone
         FROM notifications n
         JOIN customers c ON c.id = n.customer_id
         WHERE ${where}
         ORDER BY n.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    ok(res, {
      notifications: dataRes.rows,
      total:         parseInt(countRes.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('List notifications error:', err);
    fail(res, 500, 'Failed to fetch notifications');
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/send/job-ready
// Body: { customerId, workOrderId }
// ---------------------------------------------------------------------------

router.post('/send/job-ready', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { customerId, workOrderId } = req.body as Record<string, unknown>;

  if (typeof customerId  !== 'string' || !UUID_RE.test(customerId) ||
      typeof workOrderId !== 'string' || !UUID_RE.test(workOrderId)) {
    fail(res, 400, 'customerId and workOrderId must be valid UUIDs');
    return;
  }

  try {
    await sendJobReadySMS(customerId, workOrderId);
    ok(res, { sent: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send SMS';
    fail(res, 500, msg);
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/send/service-reminder
// Body: { customerId, vehicleId }
// ---------------------------------------------------------------------------

router.post('/send/service-reminder', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { customerId, vehicleId } = req.body as Record<string, unknown>;

  if (typeof customerId !== 'string' || !UUID_RE.test(customerId) ||
      typeof vehicleId  !== 'string' || !UUID_RE.test(vehicleId)) {
    fail(res, 400, 'customerId and vehicleId must be valid UUIDs');
    return;
  }

  try {
    await sendServiceReminderSMS(customerId, vehicleId);
    ok(res, { sent: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send SMS';
    fail(res, 500, msg);
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/send/invoice-email
// Body: { invoiceId }
// ---------------------------------------------------------------------------

router.post('/send/invoice-email', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { invoiceId } = req.body as Record<string, unknown>;

  if (typeof invoiceId !== 'string' || !UUID_RE.test(invoiceId)) {
    fail(res, 400, 'invoiceId must be a valid UUID');
    return;
  }

  try {
    await sendInvoiceEmail(invoiceId);
    ok(res, { sent: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send email';
    fail(res, 500, msg);
  }
});

export default router;
