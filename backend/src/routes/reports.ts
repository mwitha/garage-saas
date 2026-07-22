import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function ok(res: Response, data: unknown) {
  res.json({ data, error: null });
}
function fail(res: Response, status: number, message: string) {
  res.status(status).json({ data: null, error: { message } });
}

// ---------------------------------------------------------------------------
// GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) { fail(res, 400, 'Invalid date parameters'); return; }

  const { workshopId } = req.user!;

  // Default: first day of 12 months ago → today
  const now    = new Date();
  const toDate = parsed.data.to   ?? now.toISOString().slice(0, 10);
  const fromDate = parsed.data.from ??
    new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().slice(0, 10);

  try {
    const [revenueRes, statusRes, partsRes, techRes] = await Promise.all([

      // 1. Revenue by month — uses generate_series so every month in range appears
      pool.query<{ month: string; revenue: number }>(
        `WITH months AS (
           SELECT generate_series(
             DATE_TRUNC('month', $2::date),
             DATE_TRUNC('month', $3::date),
             '1 month'::interval
           ) AS month_start
         )
         SELECT
           TO_CHAR(m.month_start, 'Mon YYYY') AS month,
           COALESCE(SUM(i.total), 0)::float    AS revenue
         FROM months m
         LEFT JOIN invoices i
           ON  DATE_TRUNC('month', i.paid_at) = m.month_start
           AND i.workshop_id = $1
           AND i.status = 'paid'
         GROUP BY m.month_start
         ORDER BY m.month_start`,
        [workshopId, fromDate, toDate],
      ),

      // 2. Work orders by status — counts across selected range
      pool.query<{ status: string; count: number }>(
        `SELECT
           status,
           COUNT(*)::int AS count
         FROM work_orders
         WHERE workshop_id = $1
           AND created_at >= $2::date
           AND created_at <  $3::date + INTERVAL '1 day'
         GROUP BY status
         ORDER BY count DESC`,
        [workshopId, fromDate, toDate],
      ),

      // 3. Top 10 most used inventory parts (excludes free-form line items)
      pool.query<{ name: string; part_number: string | null; total_used: number }>(
        `SELECT
           ii.name,
           ii.part_number,
           SUM(woi.quantity)::float AS total_used
         FROM work_order_items woi
         JOIN inventory_items ii ON ii.id = woi.inventory_item_id
         JOIN work_orders      wo ON wo.id = woi.work_order_id
         WHERE woi.workshop_id = $1
           AND wo.created_at >= $2::date
           AND wo.created_at <  $3::date + INTERVAL '1 day'
         GROUP BY ii.id, ii.name, ii.part_number
         ORDER BY total_used DESC
         LIMIT 10`,
        [workshopId, fromDate, toDate],
      ),

      // 4. Jobs per technician — includes 'Unassigned' bucket
      pool.query<{ name: string; count: number }>(
        `SELECT
           COALESCE(u.name, 'Unassigned') AS name,
           COUNT(*)::int                  AS count
         FROM work_orders wo
         LEFT JOIN users u ON u.id = wo.assigned_to
         WHERE wo.workshop_id = $1
           AND wo.created_at >= $2::date
           AND wo.created_at <  $3::date + INTERVAL '1 day'
         GROUP BY u.name
         ORDER BY count DESC`,
        [workshopId, fromDate, toDate],
      ),
    ]);

    ok(res, {
      revenueByMonth:     revenueRes.rows,
      workOrdersByStatus: statusRes.rows,
      topParts:           partsRes.rows,
      jobsByTechnician:   techRes.rows,
      meta: { from: fromDate, to: toDate },
    });
  } catch (err) {
    console.error('Reports error:', err);
    fail(res, 500, 'Failed to generate reports');
  }
});

// ---------------------------------------------------------------------------
// GET /api/reports/aging — accounts receivable aging, one row per customer
// with an outstanding (sent/overdue) invoice. Snapshot as of now, no date range.
// ---------------------------------------------------------------------------

router.get('/aging', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;

  try {
    const { rows } = await pool.query<{
      customer_id: string;
      name: string;
      phone: string;
      email: string | null;
      invoice_count: number;
      total_outstanding: number;
      current: number;
      days_1_30: number;
      days_31_60: number;
      days_61_90: number;
      days_over_90: number;
      max_age_days: number;
    }>(
      `SELECT
         c.id                                                      AS customer_id,
         c.name,
         c.phone,
         c.email,
         COUNT(i.id)::int                                           AS invoice_count,
         SUM(i.total)::float                                        AS total_outstanding,
         SUM(CASE WHEN i.age_days <= 0                THEN i.total ELSE 0 END)::float AS current,
         SUM(CASE WHEN i.age_days BETWEEN 1  AND 30    THEN i.total ELSE 0 END)::float AS days_1_30,
         SUM(CASE WHEN i.age_days BETWEEN 31 AND 60    THEN i.total ELSE 0 END)::float AS days_31_60,
         SUM(CASE WHEN i.age_days BETWEEN 61 AND 90    THEN i.total ELSE 0 END)::float AS days_61_90,
         SUM(CASE WHEN i.age_days > 90                 THEN i.total ELSE 0 END)::float AS days_over_90,
         MAX(i.age_days)::int                                       AS max_age_days
       FROM (
         SELECT
           inv.*,
           (CURRENT_DATE - COALESCE(inv.due_date, inv.created_at::date))::int AS age_days
         FROM invoices inv
         WHERE inv.workshop_id = $1 AND inv.status IN ('sent', 'overdue')
       ) i
       JOIN work_orders wo ON wo.id = i.work_order_id
       JOIN vehicles v     ON v.id = wo.vehicle_id
       JOIN customers c    ON c.id = v.customer_id
       GROUP BY c.id, c.name, c.phone, c.email
       ORDER BY total_outstanding DESC`,
      [workshopId],
    );

    const totals = rows.reduce(
      (acc, r) => {
        acc.total_outstanding += r.total_outstanding;
        acc.current           += r.current;
        acc.days_1_30          += r.days_1_30;
        acc.days_31_60         += r.days_31_60;
        acc.days_61_90         += r.days_61_90;
        acc.days_over_90       += r.days_over_90;
        return acc;
      },
      { total_outstanding: 0, current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0 },
    );

    ok(res, { customers: rows, totals });
  } catch (err) {
    console.error('Aging report error:', err);
    fail(res, 500, 'Failed to generate aging report');
  }
});

export default router;
