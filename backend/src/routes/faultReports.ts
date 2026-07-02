import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESOLVED_STATUSES = new Set(['replacement_received', 'written_off']);

function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ data, error: null });
}
function fail(res: Response, status: number, message: string) {
  res.status(status).json({ data: null, error: { message } });
}

// ---------------------------------------------------------------------------
// POST /api/fault-reports
// ---------------------------------------------------------------------------

const createSchema = z.object({
  workOrderItemId:  z.string().uuid('Invalid work order item ID'),
  faultDescription: z.string().min(1, 'Fault description is required'),
});

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues[0]?.message ?? 'Validation failed');
    return;
  }

  const { workOrderItemId, faultDescription } = parsed.data;
  const { workshopId, userId } = req.user!;

  try {
    // Fetch the work order item to get linked IDs and supplier info from the adjustment
    const itemResult = await pool.query(
      `SELECT
         woi.work_order_id,
         woi.inventory_item_id,
         woi.stock_adjustment_id,
         sa.supplier_name,
         sa.supplier_phone,
         sa.supplier_invoice,
         wo.workshop_id
       FROM work_order_items woi
       JOIN work_orders wo ON wo.id = woi.work_order_id
       LEFT JOIN stock_adjustments sa ON sa.id = woi.stock_adjustment_id
       WHERE woi.id = $1 AND wo.workshop_id = $2`,
      [workOrderItemId, workshopId],
    );

    if (itemResult.rows.length === 0) {
      fail(res, 404, 'Work order item not found');
      return;
    }

    const item = itemResult.rows[0];

    if (!item.inventory_item_id) {
      fail(res, 400, 'Cannot report fault on a custom line item without an inventory part');
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO part_fault_reports
         (workshop_id, work_order_id, work_order_item_id, inventory_item_id,
          stock_adjustment_id, reported_by, fault_description,
          supplier_name, supplier_phone, supplier_invoice)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        workshopId,
        item.work_order_id,
        workOrderItemId,
        item.inventory_item_id,
        item.stock_adjustment_id ?? null,
        userId,
        faultDescription,
        item.supplier_name ?? null,
        item.supplier_phone ?? null,
        item.supplier_invoice ?? null,
      ],
    );

    ok(res, rows[0], 201);
  } catch (err) {
    console.error('Create fault report error:', err);
    fail(res, 500, 'Failed to create fault report');
  }
});

// ---------------------------------------------------------------------------
// GET /api/fault-reports
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;

  const statusFilter = req.query.status as string | undefined;

  const params: unknown[] = [workshopId];
  let statusClause = '';

  if (statusFilter === 'open') {
    statusClause = `AND pfr.status NOT IN ('replacement_received', 'written_off')`;
  } else if (statusFilter === 'resolved') {
    statusClause = `AND pfr.status IN ('replacement_received', 'written_off')`;
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         pfr.id,
         pfr.status,
         pfr.fault_description,
         pfr.supplier_name,
         pfr.supplier_phone,
         pfr.supplier_invoice,
         pfr.resolution_note,
         pfr.reported_at,
         pfr.resolved_at,
         ii.name        AS part_name,
         ii.part_number,
         wo.order_number AS work_order_number,
         wo.id           AS work_order_id,
         v.plate_number,
         u.name          AS reported_by_name
       FROM part_fault_reports pfr
       JOIN inventory_items  ii ON ii.id  = pfr.inventory_item_id
       JOIN work_orders      wo ON wo.id  = pfr.work_order_id
       JOIN vehicles          v  ON v.id   = wo.vehicle_id
       LEFT JOIN users        u  ON u.id   = pfr.reported_by
       WHERE pfr.workshop_id = $1 ${statusClause}
       ORDER BY pfr.reported_at DESC`,
      params,
    );
    ok(res, rows);
  } catch (err) {
    console.error('List fault reports error:', err);
    fail(res, 500, 'Failed to fetch fault reports');
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/fault-reports/:id
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  status:          z.string().min(1),
  resolution_note: z.string().optional().nullable(),
});

router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Report not found'); return; }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues[0]?.message ?? 'Validation failed');
    return;
  }

  const { status, resolution_note } = parsed.data;
  const { workshopId } = req.user!;
  const isResolved = RESOLVED_STATUSES.has(status);

  try {
    const { rows } = await pool.query(
      `UPDATE part_fault_reports
       SET status = $1,
           resolution_note = COALESCE($2, resolution_note),
           resolved_at = CASE WHEN $3 THEN NOW() ELSE resolved_at END
       WHERE id = $4 AND workshop_id = $5
       RETURNING *`,
      [status, resolution_note ?? null, isResolved, id, workshopId],
    );
    if (rows.length === 0) { fail(res, 404, 'Report not found'); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error('Update fault report error:', err);
    fail(res, 500, 'Failed to update report');
  }
});

export default router;
