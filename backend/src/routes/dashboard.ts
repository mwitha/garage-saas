import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;

  try {
    const [
      statsResult,
      chartResult,
      pipelineResult,
      lowStockResult,
      activeOrdersResult,
      todayResult,
    ] = await Promise.all([

      // ── Scalar KPIs (single round-trip) ─────────────────────────────────
      pool.query(`
        SELECT
          -- Active jobs
          (SELECT COUNT(*)::int FROM work_orders
           WHERE workshop_id = $1 AND status NOT IN ('delivered','cancelled')
          ) AS active_work_orders,

          (SELECT COUNT(DISTINCT vehicle_id)::int FROM work_orders
           WHERE workshop_id = $1 AND status NOT IN ('delivered','cancelled')
          ) AS vehicles_in_workshop,

          -- Unpaid invoices
          (SELECT COALESCE(SUM(total),0)::float FROM invoices
           WHERE workshop_id = $1 AND status IN ('sent','overdue')
          ) AS unpaid_invoices_total,

          (SELECT COUNT(*)::int FROM invoices
           WHERE workshop_id = $1 AND status IN ('sent','overdue')
          ) AS unpaid_invoices_count,

          -- Low stock count
          (SELECT COUNT(*)::int FROM inventory_items
           WHERE workshop_id = $1 AND reorder_threshold > 0
             AND quantity <= reorder_threshold
          ) AS low_stock_items,

          -- Revenue today
          (SELECT COALESCE(SUM(total),0)::float FROM invoices
           WHERE workshop_id = $1 AND status = 'paid'
             AND DATE(paid_at AT TIME ZONE 'UTC') = CURRENT_DATE
          ) AS revenue_today,

          -- Revenue this month
          (SELECT COALESCE(SUM(total),0)::float FROM invoices
           WHERE workshop_id = $1 AND status = 'paid'
             AND DATE_TRUNC('month', paid_at) = DATE_TRUNC('month', NOW())
          ) AS revenue_this_month,

          -- Revenue last month
          (SELECT COALESCE(SUM(total),0)::float FROM invoices
           WHERE workshop_id = $1 AND status = 'paid'
             AND DATE_TRUNC('month', paid_at) = DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
          ) AS revenue_last_month,

          -- Expenses this month
          (SELECT COALESCE(SUM(amount),0)::float FROM expenses
           WHERE workshop_id = $1
             AND DATE_TRUNC('month', date::timestamptz) = DATE_TRUNC('month', NOW())
          ) AS expenses_this_month,

          -- Expenses last month
          (SELECT COALESCE(SUM(amount),0)::float FROM expenses
           WHERE workshop_id = $1
             AND DATE_TRUNC('month', date::timestamptz) = DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
          ) AS expenses_last_month,

          -- Jobs completed today
          (SELECT COUNT(*)::int FROM work_orders
           WHERE workshop_id = $1 AND status = 'delivered'
             AND DATE(updated_at AT TIME ZONE 'UTC') = CURRENT_DATE
          ) AS completed_today,

          -- Jobs completed this month
          (SELECT COUNT(*)::int FROM work_orders
           WHERE workshop_id = $1 AND status = 'delivered'
             AND DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', NOW())
          ) AS completed_this_month,

          -- Jobs completed last month
          (SELECT COUNT(*)::int FROM work_orders
           WHERE workshop_id = $1 AND status = 'delivered'
             AND DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
          ) AS completed_last_month,

          -- Jobs received today
          (SELECT COUNT(*)::int FROM work_orders
           WHERE workshop_id = $1
             AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
          ) AS jobs_today
      `, [workshopId]),

      // ── Monthly Revenue vs Expenses chart (last 6 months) ───────────────
      pool.query(`
        WITH months AS (
          SELECT generate_series(
            DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
            DATE_TRUNC('month', NOW()),
            INTERVAL '1 month'
          ) AS month
        ),
        rev AS (
          SELECT DATE_TRUNC('month', paid_at) AS month, COALESCE(SUM(total),0) AS revenue
          FROM invoices
          WHERE workshop_id = $1 AND status = 'paid'
            AND paid_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
          GROUP BY 1
        ),
        exp AS (
          SELECT DATE_TRUNC('month', date::timestamptz) AS month, COALESCE(SUM(amount),0) AS expenses
          FROM expenses
          WHERE workshop_id = $1
            AND date >= (DATE_TRUNC('month', NOW()) - INTERVAL '5 months')::date
          GROUP BY 1
        )
        SELECT
          TO_CHAR(m.month, 'Mon YY') AS month,
          COALESCE(r.revenue, 0)::float  AS revenue,
          COALESCE(e.expenses, 0)::float AS expenses
        FROM months m
        LEFT JOIN rev r ON r.month = m.month
        LEFT JOIN exp e ON e.month = m.month
        ORDER BY m.month
      `, [workshopId]),

      // ── Work order pipeline (active jobs by status) ──────────────────────
      pool.query(`
        SELECT status, COUNT(*)::int AS count
        FROM work_orders
        WHERE workshop_id = $1 AND status NOT IN ('delivered','cancelled')
        GROUP BY status
        ORDER BY count DESC
      `, [workshopId]),

      // ── Low stock items list ─────────────────────────────────────────────
      pool.query(`
        SELECT id, name, category, quantity::float, reorder_threshold::float
        FROM inventory_items
        WHERE workshop_id = $1 AND reorder_threshold > 0
          AND quantity <= reorder_threshold
        ORDER BY (quantity::float / NULLIF(reorder_threshold::float, 0)) ASC
        LIMIT 8
      `, [workshopId]),

      // ── Active work orders (not delivered/cancelled) ─────────────────────
      pool.query(`
        SELECT
          wo.id,
          wo.order_number,
          wo.status,
          wo.created_at,
          wo.customer_complaint,
          v.plate_number,
          v.make,
          v.model,
          c.name  AS customer_name,
          u.name  AS assigned_to_name
        FROM work_orders wo
        JOIN  vehicles  v ON v.id = wo.vehicle_id
        JOIN  customers c ON c.id = v.customer_id
        LEFT JOIN users u ON u.id = wo.assigned_to
        WHERE wo.workshop_id = $1
          AND wo.status NOT IN ('delivered','cancelled')
        ORDER BY wo.created_at DESC
        LIMIT 12
      `, [workshopId]),

      // ── Today's jobs ─────────────────────────────────────────────────────
      pool.query(`
        SELECT
          wo.id,
          wo.order_number,
          wo.status,
          wo.created_at,
          wo.customer_complaint,
          v.plate_number,
          v.make,
          v.model,
          c.name  AS customer_name,
          u.name  AS assigned_to_name
        FROM work_orders wo
        JOIN  vehicles  v ON v.id = wo.vehicle_id
        JOIN  customers c ON c.id = v.customer_id
        LEFT JOIN users u ON u.id = wo.assigned_to
        WHERE wo.workshop_id = $1
          AND DATE(wo.created_at AT TIME ZONE 'UTC') = CURRENT_DATE
        ORDER BY wo.created_at ASC
      `, [workshopId]),
    ]);

    res.json({
      data: {
        stats:               statsResult.rows[0],
        revenue_chart:       chartResult.rows,
        pipeline:            pipelineResult.rows,
        low_stock_list:      lowStockResult.rows,
        active_work_orders:  activeOrdersResult.rows,
        todays_jobs:         todayResult.rows,
      },
      error: null,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ data: null, error: { message: 'Failed to load dashboard' } });
  }
});

export default router;
