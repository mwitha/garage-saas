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
      invoice_id: string;
      invoice_number: string;
      status: string;
      due_date: string | null;
      total: number;
      age_days: number;
    }>(
      `SELECT
         c.id           AS customer_id,
         c.name,
         c.phone,
         c.email,
         inv.id          AS invoice_id,
         inv.invoice_number,
         inv.status,
         inv.due_date,
         inv.total::float AS total,
         (CURRENT_DATE - COALESCE(inv.due_date, inv.created_at::date))::int AS age_days
       FROM invoices inv
       JOIN work_orders wo ON wo.id = inv.work_order_id
       JOIN vehicles v     ON v.id = wo.vehicle_id
       JOIN customers c    ON c.id = v.customer_id
       WHERE inv.workshop_id = $1 AND inv.status IN ('sent', 'overdue')
       ORDER BY c.name, inv.due_date NULLS LAST`,
      [workshopId],
    );

    function bucketOf(ageDays: number) {
      if (ageDays <= 0) return 'current';
      if (ageDays <= 30) return 'days_1_30';
      if (ageDays <= 60) return 'days_31_60';
      if (ageDays <= 90) return 'days_61_90';
      return 'days_over_90';
    }

    const byCustomer = new Map<string, {
      customer_id: string; name: string; phone: string; email: string | null;
      invoice_count: number; total_outstanding: number;
      current: number; days_1_30: number; days_31_60: number; days_61_90: number; days_over_90: number;
      max_age_days: number;
      invoices: { id: string; invoice_number: string; status: string; due_date: string | null; total: number; age_days: number }[];
    }>();

    const totals = { total_outstanding: 0, current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0 };

    for (const r of rows) {
      if (!byCustomer.has(r.customer_id)) {
        byCustomer.set(r.customer_id, {
          customer_id: r.customer_id, name: r.name, phone: r.phone, email: r.email,
          invoice_count: 0, total_outstanding: 0,
          current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0,
          max_age_days: 0, invoices: [],
        });
      }
      const c = byCustomer.get(r.customer_id)!;
      c.invoice_count += 1;
      c.total_outstanding += r.total;
      c[bucketOf(r.age_days)] += r.total;
      c.max_age_days = Math.max(c.max_age_days, r.age_days);
      c.invoices.push({
        id: r.invoice_id, invoice_number: r.invoice_number, status: r.status,
        due_date: r.due_date, total: r.total, age_days: r.age_days,
      });

      totals.total_outstanding += r.total;
      totals[bucketOf(r.age_days)] += r.total;
    }

    const customers = [...byCustomer.values()].sort((a, b) => b.total_outstanding - a.total_outstanding);

    ok(res, { customers, totals });
  } catch (err) {
    console.error('Aging report error:', err);
    fail(res, 500, 'Failed to generate aging report');
  }
});

export default router;
