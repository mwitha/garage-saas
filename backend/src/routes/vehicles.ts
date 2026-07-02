import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bare column list — used in RETURNING and simple FROM clauses
const VEHICLE_COLS = `
  id, customer_id, plate_number, make, model, year, color,
  fuel_type, engine_capacity, engine_number, transmission, mileage, vin,
  ac_system, notes, created_at, updated_at`;

// Aliased column list — used when the table is aliased as v in JOINs
const VEHICLE_COLS_J = `
  v.id, v.customer_id, v.plate_number, v.make, v.model, v.year, v.color,
  v.fuel_type, v.engine_capacity, v.engine_number, v.transmission, v.mileage, v.vin,
  v.ac_system, v.notes, v.created_at, v.updated_at`;

// --- Schemas ---

const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'lpg', 'other'] as const;

const vehicleSchema = z.object({
  plate_number:    z.string().min(1).transform((v) => v.toUpperCase()),
  make:            z.string().min(1),
  model:           z.string().min(1),
  year:            z.number().int().min(1886).max(2100).optional(),
  color:           z.string().optional(),
  fuel_type:       z.enum(FUEL_TYPES).optional(),
  engine_capacity: z.string().optional(),
  engine_number:   z.string().optional(),
  transmission:    z.enum(['manual', 'auto']).optional(),
  mileage:         z.number().int().nonnegative().optional(),
  vin:             z.string().optional(),
  ac_system:       z.string().optional(),
  notes:           z.string().optional(),
});

const updateVehicleSchema = vehicleSchema.partial();

const listQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const UPDATABLE_COLS = [
  'plate_number', 'make', 'model', 'year', 'color', 'fuel_type',
  'engine_capacity', 'engine_number', 'transmission', 'mileage', 'vin',
  'ac_system', 'notes',
] as const;

// --- Helpers ---

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data, error: null });
}

function fail(res: Response, status: number, message: string, details?: unknown): void {
  res.status(status).json({ data: null, error: { message, ...(details ? { details } : {}) } });
}

function isDuplicatePlate(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

// Returns true if the customer exists within the given workshop.
// Both existence and ownership are checked in one query so a missing-vs-wrong-workshop
// distinction is never leaked to the caller.
async function customerBelongsToWorkshop(customerId: string, workshopId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM customers WHERE id = $1 AND workshop_id = $2',
    [customerId, workshopId],
  );
  return (rowCount ?? 0) > 0;
}

// =============================================================================
// Standalone router  —  mounted at /api/vehicles
// =============================================================================

export const vehiclesRouter = Router();

// GET /api/vehicles?search=&page=&limit=
vehiclesRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'Invalid query parameters', parsed.error.flatten());
    return;
  }

  const { search, page, limit } = parsed.data;
  const { workshopId } = req.user!;
  const offset = (page - 1) * limit;

  const baseParams: unknown[] = [workshopId];
  let searchClause = '';

  if (search?.trim()) {
    baseParams.push(`%${search.trim()}%`);
    const p = baseParams.length;
    searchClause =
      ` AND (v.plate_number ILIKE $${p} OR v.make ILIKE $${p} OR v.model ILIKE $${p})`;
  }

  try {
    const [countResult, dataResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM vehicles v WHERE v.workshop_id = $1${searchClause}`,
        baseParams,
      ),
      pool.query(
        `SELECT ${VEHICLE_COLS_J},
                c.name  AS customer_name,
                c.phone AS customer_phone
         FROM vehicles v
         JOIN customers c ON c.id = v.customer_id
         WHERE v.workshop_id = $1${searchClause}
         ORDER BY v.created_at DESC
         LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`,
        [...baseParams, limit, offset],
      ),
    ]);

    ok(res, {
      vehicles: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('List vehicles error:', err);
    fail(res, 500, 'Failed to fetch vehicles');
  }
});

// GET /api/vehicles/:id  — includes full service history with costs
vehiclesRouter.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    fail(res, 404, 'Vehicle not found');
    return;
  }

  const { workshopId } = req.user!;

  try {
    const [vehicleResult, ordersResult] = await Promise.all([
      pool.query(
        `SELECT ${VEHICLE_COLS_J},
                c.name  AS customer_name,
                c.phone AS customer_phone
         FROM vehicles v
         JOIN customers c ON c.id = v.customer_id
         WHERE v.id = $1 AND v.workshop_id = $2`,
        [id, workshopId],
      ),
      pool.query(
        `SELECT
           wo.id, wo.order_number, wo.status,
           wo.customer_complaint, wo.created_at, wo.completed_at,
           wo.labour_cost::float,
           COALESCE(SUM(woi.line_total), 0)::float AS parts_total,
           (wo.labour_cost + COALESCE(SUM(woi.line_total), 0))::float AS total
         FROM work_orders wo
         LEFT JOIN work_order_items woi ON woi.work_order_id = wo.id
         WHERE wo.vehicle_id = $1 AND wo.workshop_id = $2
         GROUP BY wo.id
         ORDER BY wo.created_at DESC`,
        [id, workshopId],
      ),
    ]);

    if (vehicleResult.rows.length === 0) {
      fail(res, 404, 'Vehicle not found');
      return;
    }

    ok(res, { ...vehicleResult.rows[0], work_orders: ordersResult.rows });
  } catch (err) {
    console.error('Get vehicle error:', err);
    fail(res, 500, 'Failed to fetch vehicle');
  }
});

// PUT /api/vehicles/:id
vehiclesRouter.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    fail(res, 404, 'Vehicle not found');
    return;
  }

  const parsed = updateVehicleSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'Validation failed', parsed.error.flatten());
    return;
  }

  const fields = parsed.data;
  if (Object.keys(fields).length === 0) {
    fail(res, 400, 'No fields provided for update');
    return;
  }

  const { workshopId } = req.user!;
  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const col of UPDATABLE_COLS) {
    if (col in fields) {
      params.push(fields[col] ?? null);
      setClauses.push(`${col} = $${params.length}`);
    }
  }

  params.push(id, workshopId);
  const idIdx = params.length - 1;
  const wsIdx = params.length;

  try {
    const { rows } = await pool.query(
      `UPDATE vehicles
       SET ${setClauses.join(', ')}
       WHERE id = $${idIdx} AND workshop_id = $${wsIdx}
       RETURNING ${VEHICLE_COLS}`,
      params,
    );

    if (rows.length === 0) {
      fail(res, 404, 'Vehicle not found');
      return;
    }

    ok(res, rows[0]);
  } catch (err) {
    if (isDuplicatePlate(err)) {
      fail(res, 409, 'A vehicle with this plate number already exists in this workshop');
      return;
    }
    console.error('Update vehicle error:', err);
    fail(res, 500, 'Failed to update vehicle');
  }
});

// DELETE /api/vehicles/:id
vehiclesRouter.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    fail(res, 404, 'Vehicle not found');
    return;
  }

  const { workshopId } = req.user!;

  try {
    const { rows } = await pool.query(
      'DELETE FROM vehicles WHERE id = $1 AND workshop_id = $2 RETURNING id',
      [id, workshopId],
    );

    if (rows.length === 0) {
      fail(res, 404, 'Vehicle not found');
      return;
    }

    ok(res, { id: rows[0].id });
  } catch (err) {
    console.error('Delete vehicle error:', err);
    fail(res, 500, 'Failed to delete vehicle');
  }
});

// =============================================================================
// Customer-nested router  —  mounted at /api/customers/:customerId/vehicles
// mergeParams: true makes :customerId visible inside this router
// =============================================================================

export const customerVehiclesRouter = Router({ mergeParams: true });

// GET /api/customers/:customerId/vehicles
customerVehiclesRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const customerId = req.params.customerId as string;
  if (!UUID_RE.test(customerId)) {
    fail(res, 404, 'Customer not found');
    return;
  }

  const { workshopId } = req.user!;

  try {
    const owned = await customerBelongsToWorkshop(customerId, workshopId);
    if (!owned) {
      fail(res, 404, 'Customer not found');
      return;
    }

    const { rows } = await pool.query(
      `SELECT ${VEHICLE_COLS}
       FROM vehicles
       WHERE customer_id = $1 AND workshop_id = $2
       ORDER BY plate_number ASC`,
      [customerId, workshopId],
    );

    ok(res, { vehicles: rows });
  } catch (err) {
    console.error('List customer vehicles error:', err);
    fail(res, 500, 'Failed to fetch vehicles');
  }
});

// POST /api/customers/:customerId/vehicles
customerVehiclesRouter.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const customerId = req.params.customerId as string;
  if (!UUID_RE.test(customerId)) {
    fail(res, 404, 'Customer not found');
    return;
  }

  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'Validation failed', parsed.error.flatten());
    return;
  }

  const { workshopId } = req.user!;

  try {
    // Ownership check before any insert — prevents cross-tenant vehicle creation
    const owned = await customerBelongsToWorkshop(customerId, workshopId);
    if (!owned) {
      fail(res, 404, 'Customer not found');
      return;
    }

    const {
      plate_number, make, model, year, color, fuel_type,
      engine_capacity, engine_number, transmission, mileage, vin, ac_system, notes,
    } = parsed.data;

    const { rows } = await pool.query(
      `INSERT INTO vehicles
         (workshop_id, customer_id, plate_number, make, model, year, color,
          fuel_type, engine_capacity, engine_number, transmission, mileage, vin, ac_system, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${VEHICLE_COLS}`,
      [
        workshopId, customerId, plate_number, make, model,
        year ?? null, color ?? null, fuel_type ?? null,
        engine_capacity ?? null, engine_number ?? null, transmission ?? null,
        mileage ?? null, vin ?? null, ac_system ?? null, notes ?? null,
      ],
    );

    ok(res, rows[0], 201);
  } catch (err) {
    if (isDuplicatePlate(err)) {
      fail(res, 409, 'A vehicle with this plate number already exists in this workshop');
      return;
    }
    console.error('Create vehicle error:', err);
    fail(res, 500, 'Failed to create vehicle');
  }
});
