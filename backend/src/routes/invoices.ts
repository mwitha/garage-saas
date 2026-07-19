import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import puppeteer from 'puppeteer-core';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';
import { sendInvoiceEmail } from '../services/notifications';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'] as const;
const PAYMENT_METHODS  = ['cash', 'card', 'bank_transfer', 'cheque', 'other'] as const;

type InvoiceStatus = typeof INVOICE_STATUSES[number];
type PaymentMethod = typeof PAYMENT_METHODS[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ data, error: null });
}

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ data: null, error: { message } });
}

function formatLKR(n: number): string {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-LK', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// GET /api/invoices
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  search: z.string().optional(),
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
});

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) { fail(res, 400, 'Invalid query parameters'); return; }

  const { status, search, page, limit } = parsed.data;
  const { workshopId } = req.user!;
  const offset = (page - 1) * limit;

  const params: unknown[] = [workshopId];
  const conditions: string[] = ['i.workshop_id = $1'];

  if (status) {
    params.push(status);
    conditions.push(`i.status = $${params.length}`);
  }
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    const p = params.length;
    conditions.push(`(i.invoice_number ILIKE $${p} OR c.name ILIKE $${p} OR v.plate_number ILIKE $${p})`);
  }

  const where = conditions.join(' AND ');

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM invoices i
         JOIN work_orders wo ON wo.id = i.work_order_id
         JOIN vehicles v ON v.id = wo.vehicle_id
         JOIN customers c ON c.id = v.customer_id
         WHERE ${where}`,
        params,
      ),
      pool.query(
        `SELECT
           i.id, i.invoice_number, i.status, i.subtotal::float, i.tax_amount::float,
           i.discount::float, i.total::float, i.payment_method, i.paid_at,
           i.due_date, i.created_at,
           c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone,
           v.plate_number, v.make, v.model,
           wo.order_number, wo.id AS work_order_id
         FROM invoices i
         JOIN work_orders wo ON wo.id = i.work_order_id
         JOIN vehicles v ON v.id = wo.vehicle_id
         JOIN customers c ON c.id = v.customer_id
         WHERE ${where}
         ORDER BY i.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    ok(res, {
      invoices: dataRes.rows,
      total: parseInt(countRes.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('List invoices error:', err);
    fail(res, 500, 'Failed to fetch invoices');
  }
});

// ---------------------------------------------------------------------------
// GET /api/invoices/:id
// ---------------------------------------------------------------------------

router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Invoice not found'); return; }

  const { workshopId } = req.user!;

  try {
    const [invRes, itemsRes] = await Promise.all([
      pool.query(
        `SELECT
           i.id, i.invoice_number, i.status, i.notes,
           i.subtotal::float, i.tax_rate::float, i.tax_amount::float,
           i.discount::float, i.total::float,
           i.payment_method, i.payment_reference, i.paid_at, i.due_date, i.created_at, i.updated_at,
           wo.id AS work_order_id, wo.order_number, wo.mileage_in, wo.mileage_out,
           wo.customer_complaint, wo.diagnosis,
           v.id AS vehicle_id, v.plate_number, v.make, v.model, v.year, v.color, v.fuel_type,
           c.id AS customer_id, c.name AS customer_name,
           c.phone AS customer_phone, c.email AS customer_email, c.address AS customer_address,
           ws.name AS workshop_name, ws.address AS workshop_address, ws.city AS workshop_city,
           ws.phone AS workshop_phone, ws.logo_url, ws.currency, ws.tax_label
         FROM invoices i
         JOIN work_orders wo ON wo.id = i.work_order_id
         JOIN vehicles v ON v.id = wo.vehicle_id
         JOIN customers c ON c.id = v.customer_id
         JOIN workshops ws ON ws.id = i.workshop_id
         WHERE i.id = $1 AND i.workshop_id = $2`,
        [id, workshopId],
      ),
      pool.query(
        `SELECT id, description, quantity::float, unit_price::float, line_total::float
         FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id`,
        [id],
      ),
    ]);

    if (invRes.rows.length === 0) { fail(res, 404, 'Invoice not found'); return; }
    ok(res, { ...invRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    console.error('Get invoice error:', err);
    fail(res, 500, 'Failed to fetch invoice');
  }
});

// ---------------------------------------------------------------------------
// POST /api/invoices/from-work-order/:workOrderId
// ---------------------------------------------------------------------------

const createSchema = z.object({
  discount: z.number().nonnegative().default(0),
  notes:    z.string().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post('/from-work-order/:workOrderId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const woId = req.params.workOrderId as string;
  if (!UUID_RE.test(woId)) { fail(res, 400, 'Invalid work order ID'); return; }

  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const { discount, notes, due_date } = parsed.data;
  const { workshopId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify WO belongs to this workshop
    const woRes = await client.query(
      `SELECT wo.id, wo.labour_cost::float, wo.status,
              ws.tax_rate::float, ws.tax_enabled, ws.invoice_prefix, ws.invoice_counter,
              ws.name AS workshop_name
       FROM work_orders wo
       JOIN workshops ws ON ws.id = wo.workshop_id
       WHERE wo.id = $1 AND wo.workshop_id = $2
       FOR UPDATE OF ws`,
      [woId, workshopId],
    );
    if (woRes.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Work order not found');
      return;
    }

    const wo = woRes.rows[0];

    // Block duplicate invoices (allow re-create only if prior one was cancelled)
    const existingRes = await client.query(
      `SELECT id, status FROM invoices WHERE work_order_id = $1 AND workshop_id = $2`,
      [woId, workshopId],
    );
    if (existingRes.rows.length > 0 && existingRes.rows[0].status !== 'cancelled') {
      await client.query('ROLLBACK');
      fail(res, 409, 'An invoice already exists for this work order');
      return;
    }

    // Fetch work order items to snapshot
    const itemsRes = await client.query(
      `SELECT description, quantity::float, unit_price::float, line_total::float
       FROM work_order_items WHERE work_order_id = $1`,
      [woId],
    );

    // Build snapshot lines: parts lines + labour line (if > 0)
    const lines: { description: string; quantity: number; unit_price: number }[] = [
      ...itemsRes.rows,
      ...(wo.labour_cost > 0
        ? [{ description: 'Labour', quantity: 1, unit_price: wo.labour_cost }]
        : []),
    ];

    const subtotal        = lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
    const effective_rate  = wo.tax_enabled ? wo.tax_rate : 0;
    const tax_amount      = Math.round((subtotal * effective_rate) / 100 * 100) / 100;
    const total           = subtotal + tax_amount - discount;

    // Atomically increment invoice counter
    const counterRes = await client.query(
      `UPDATE workshops
       SET invoice_counter = invoice_counter + 1
       WHERE id = $1
       RETURNING invoice_counter, invoice_prefix`,
      [workshopId],
    );
    const { invoice_counter, invoice_prefix } = counterRes.rows[0];
    const invoiceNumber = `${invoice_prefix}-${String(invoice_counter).padStart(5, '0')}`;

    // Create invoice
    const invRes = await client.query(
      `INSERT INTO invoices
         (workshop_id, work_order_id, invoice_number, status,
          subtotal, tax_rate, tax_amount, discount, total, notes, due_date)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, invoice_number, status, subtotal::float, tax_rate::float,
                 tax_amount::float, discount::float, total::float, due_date, created_at`,
      [
        workshopId, woId, invoiceNumber,
        subtotal, effective_rate, tax_amount, discount, total,
        notes ?? null, due_date ?? null,
      ],
    );
    const invoice = invRes.rows[0];

    // Insert snapshot line items (preserving parts-then-labour order)
    if (lines.length > 0) {
      const valuePlaceholders = lines
        .map((_, i) => `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`)
        .join(', ');
      const flatValues = lines.flatMap((l, i) => [l.description, l.quantity, l.unit_price, i]);
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, sort_order) VALUES ${valuePlaceholders}`,
        [invoice.id, ...flatValues],
      );
    }

    await client.query('COMMIT');
    ok(res, invoice, 201);

    // Fire-and-forget: email the invoice to the customer if they have an email
    sendInvoiceEmail(invoice.id as string).catch((err: unknown) => {
      console.error('[notifications] invoice email failed (non-fatal):', err);
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create invoice error:', err);
    fail(res, 500, 'Failed to create invoice');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/invoices/:id/pay
// ---------------------------------------------------------------------------

const paySchema = z.object({
  payment_method:    z.enum(PAYMENT_METHODS),
  payment_reference: z.string().optional(),
});

router.patch('/:id/pay', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Invoice not found'); return; }

  const parsed = paySchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'payment_method is required'); return; }

  const { payment_method, payment_reference } = parsed.data;
  const { workshopId } = req.user!;

  try {
    const current = await pool.query(
      'SELECT status FROM invoices WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if (current.rows.length === 0) { fail(res, 404, 'Invoice not found'); return; }
    if (current.rows[0].status === 'cancelled') {
      fail(res, 409, 'Cannot mark a cancelled invoice as paid'); return;
    }

    const { rows } = await pool.query(
      `UPDATE invoices
       SET status = 'paid', payment_method = $1, payment_reference = $2,
           paid_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND workshop_id = $4
       RETURNING id, status, payment_method, payment_reference, paid_at`,
      [payment_method, payment_reference ?? null, id, workshopId],
    );
    ok(res, rows[0]);
  } catch (err) {
    console.error('Pay invoice error:', err);
    fail(res, 500, 'Failed to mark invoice as paid');
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/invoices/:id/discount — set a flat discount on a draft invoice
// ---------------------------------------------------------------------------

const discountSchema = z.object({
  discount: z.number().nonnegative(),
});

router.patch('/:id/discount', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Invoice not found'); return; }

  const parsed = discountSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'Invalid discount amount'); return; }

  const { discount } = parsed.data;
  const { workshopId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invCheck = await client.query(
      'SELECT id, status FROM invoices WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if (invCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Invoice not found');
      return;
    }
    if (invCheck.rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Only draft invoices can be edited');
      return;
    }

    await client.query('UPDATE invoices SET discount = $1 WHERE id = $2', [discount, id]);
    const totals = await recalcInvoiceTotals(client, id);

    await client.query('COMMIT');
    ok(res, { discount, ...totals });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Set invoice discount error:', err);
    fail(res, 500, 'Failed to update discount');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/items — add a line item directly to a draft invoice
// ---------------------------------------------------------------------------

const addInvoiceItemSchema = z.object({
  description: z.string().min(1),
  quantity:    z.number().positive(),
  unit_price:  z.number().nonnegative(),
});

async function recalcInvoiceTotals(
  client: PoolClient,
  invoiceId: string,
): Promise<{ subtotal: number; tax_amount: number; total: number }> {
  const itemsRes = await client.query(
    'SELECT quantity::float, unit_price::float FROM invoice_items WHERE invoice_id = $1',
    [invoiceId],
  );
  const subtotal = itemsRes.rows.reduce(
    (sum: number, r: { quantity: number; unit_price: number }) => sum + r.quantity * r.unit_price, 0,
  );

  const invRes = await client.query(
    'SELECT tax_rate::float, discount::float FROM invoices WHERE id = $1 FOR UPDATE',
    [invoiceId],
  );
  const { tax_rate, discount } = invRes.rows[0];
  const tax_amount = Math.round((subtotal * tax_rate) / 100 * 100) / 100;
  const total = subtotal + tax_amount - discount;

  await client.query(
    `UPDATE invoices SET subtotal = $1, tax_amount = $2, total = $3, updated_at = NOW() WHERE id = $4`,
    [subtotal, tax_amount, total, invoiceId],
  );

  return { subtotal, tax_amount, total };
}

router.post('/:id/items', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Invoice not found'); return; }

  const parsed = addInvoiceItemSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const { description, quantity, unit_price } = parsed.data;
  const { workshopId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invCheck = await client.query(
      'SELECT id, status FROM invoices WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if (invCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Invoice not found');
      return;
    }
    if (invCheck.rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Only draft invoices can be edited');
      return;
    }

    const itemRes = await client.query(
      `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, sort_order)
       VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM invoice_items WHERE invoice_id = $1), 0))
       RETURNING id, description, quantity::float, unit_price::float, line_total::float`,
      [id, description, quantity, unit_price],
    );

    const totals = await recalcInvoiceTotals(client, id);

    await client.query('COMMIT');
    ok(res, { item: itemRes.rows[0], ...totals }, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Add invoice item error:', err);
    fail(res, 500, 'Failed to add item');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/invoices/:id/items/reorder — reposition line items
// NOTE: must be registered before PATCH /:id/items/:itemId, otherwise
// "reorder" would be captured as :itemId and 404 on the UUID check.
// ---------------------------------------------------------------------------

const reorderSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
});

router.patch('/:id/items/reorder', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Invoice not found'); return; }

  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const { itemIds } = parsed.data;
  const { workshopId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invCheck = await client.query(
      'SELECT id, status FROM invoices WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if (invCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Invoice not found');
      return;
    }
    if (invCheck.rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Only draft invoices can be edited');
      return;
    }

    const existing = await client.query(
      'SELECT id FROM invoice_items WHERE invoice_id = $1',
      [id],
    );
    const existingIds = new Set(existing.rows.map((r: { id: string }) => r.id));
    const providedIds = new Set(itemIds);
    if (existingIds.size !== providedIds.size || ![...existingIds].every((i) => providedIds.has(i))) {
      await client.query('ROLLBACK');
      fail(res, 400, 'itemIds must match the invoice\'s current items exactly');
      return;
    }

    for (let i = 0; i < itemIds.length; i++) {
      await client.query(
        'UPDATE invoice_items SET sort_order = $1 WHERE id = $2 AND invoice_id = $3',
        [i, itemIds[i], id],
      );
    }

    await client.query('COMMIT');
    ok(res, { itemIds });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reorder invoice items error:', err);
    fail(res, 500, 'Failed to reorder items');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/invoices/:id/items/:itemId — edit a line item's description/qty/price
// ---------------------------------------------------------------------------

const editInvoiceItemSchema = z.object({
  description: z.string().min(1).optional(),
  quantity:    z.number().positive().optional(),
  unit_price:  z.number().nonnegative().optional(),
});

router.patch('/:id/items/:itemId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const itemId = req.params.itemId as string;
  if (!UUID_RE.test(id) || !UUID_RE.test(itemId)) { fail(res, 404, 'Not found'); return; }

  const parsed = editInvoiceItemSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    fail(res, 400, 'Validation failed'); return;
  }

  const { description, quantity, unit_price } = parsed.data;
  const { workshopId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invCheck = await client.query(
      'SELECT id, status FROM invoices WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if (invCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Invoice not found');
      return;
    }
    if (invCheck.rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Only draft invoices can be edited');
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [itemId, id];
    const set = (col: string, val: unknown) => {
      if (val === undefined) return;
      values.push(val);
      fields.push(`${col} = $${values.length}`);
    };
    set('description', description);
    set('quantity', quantity);
    set('unit_price', unit_price);

    const itemRes = await client.query(
      `UPDATE invoice_items SET ${fields.join(', ')}
       WHERE id = $1 AND invoice_id = $2
       RETURNING id, description, quantity::float, unit_price::float, line_total::float`,
      values,
    );
    if (itemRes.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Item not found');
      return;
    }

    const totals = await recalcInvoiceTotals(client, id);

    await client.query('COMMIT');
    ok(res, { item: itemRes.rows[0], ...totals });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Edit invoice item error:', err);
    fail(res, 500, 'Failed to update item');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/invoices/:id/items/:itemId
// ---------------------------------------------------------------------------

router.delete('/:id/items/:itemId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const itemId = req.params.itemId as string;
  if (!UUID_RE.test(id) || !UUID_RE.test(itemId)) { fail(res, 404, 'Not found'); return; }

  const { workshopId } = req.user!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invCheck = await client.query(
      'SELECT id, status FROM invoices WHERE id = $1 AND workshop_id = $2',
      [id, workshopId],
    );
    if (invCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Invoice not found');
      return;
    }
    if (invCheck.rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      fail(res, 409, 'Only draft invoices can be edited');
      return;
    }

    const delRes = await client.query(
      'DELETE FROM invoice_items WHERE id = $1 AND invoice_id = $2 RETURNING id',
      [itemId, id],
    );
    if (delRes.rows.length === 0) {
      await client.query('ROLLBACK');
      fail(res, 404, 'Item not found');
      return;
    }

    const totals = await recalcInvoiceTotals(client, id);

    await client.query('COMMIT');
    ok(res, { id: itemId, ...totals });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete invoice item error:', err);
    fail(res, 500, 'Failed to delete item');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/pdf  — render HTML → PDF via puppeteer-core
// ---------------------------------------------------------------------------

router.get('/:id/pdf', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) { fail(res, 404, 'Invoice not found'); return; }

  const { workshopId } = req.user!;

  try {
    const [invRes, itemsRes] = await Promise.all([
      pool.query(
        `SELECT
           i.id, i.invoice_number, i.status, i.notes,
           i.subtotal::float, i.tax_rate::float, i.tax_amount::float,
           i.discount::float, i.total::float,
           i.payment_method, i.payment_reference, i.paid_at, i.due_date, i.created_at,
           wo.order_number, wo.customer_complaint,
           v.plate_number, v.make, v.model, v.year,
           c.name AS customer_name, c.phone AS customer_phone,
           c.email AS customer_email, c.address AS customer_address,
           ws.name AS workshop_name, ws.address AS workshop_address,
           ws.city AS workshop_city, ws.phone AS workshop_phone,
           ws.email AS workshop_email, ws.website AS workshop_website,
           ws.currency, ws.tax_label
         FROM invoices i
         JOIN work_orders wo ON wo.id = i.work_order_id
         JOIN vehicles v ON v.id = wo.vehicle_id
         JOIN customers c ON c.id = v.customer_id
         JOIN workshops ws ON ws.id = i.workshop_id
         WHERE i.id = $1 AND i.workshop_id = $2`,
        [id, workshopId],
      ),
      pool.query(
        `SELECT description, quantity::float, unit_price::float, line_total::float
         FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id`,
        [id],
      ),
    ]);

    if (invRes.rows.length === 0) { fail(res, 404, 'Invoice not found'); return; }

    const inv   = invRes.rows[0];
    const items = itemsRes.rows as { description: string; quantity: number; unit_price: number; line_total: number }[];

    const html = buildInvoiceHtml(inv, items);

    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${inv.invoice_number}.pdf"`,
      );
      res.send(Buffer.from(pdf));
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error('PDF generation error:', err);
    fail(res, 500, 'Failed to generate PDF');
  }
});

// ---------------------------------------------------------------------------
// HTML template for PDF
// ---------------------------------------------------------------------------

interface InvoiceRow {
  invoice_number: string;
  status: InvoiceStatus;
  notes: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod | null;
  payment_reference: string | null;
  paid_at: string | null;
  due_date: string | null;
  created_at: string;
  order_number: string;
  customer_complaint: string | null;
  plate_number: string;
  make: string;
  model: string;
  year: number | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_address: string | null;
  workshop_name: string;
  workshop_address: string | null;
  workshop_city: string | null;
  workshop_phone: string | null;
  workshop_email: string | null;
  workshop_website: string | null;
  currency: string;
  tax_label: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

function buildInvoiceHtml(inv: InvoiceRow, items: LineItem[]): string {
  const currency = inv.currency ?? 'LKR';

  function fmt(n: number): string {
    return `${currency} ${Math.round(n).toLocaleString('en-US')}`;
  }

  const itemRows = items.map((item) => `
    <tr>
      <td>${escHtml(item.description)}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:right">${fmt(item.unit_price)}</td>
      <td style="text-align:right;font-weight:600">${fmt(item.line_total)}</td>
    </tr>
  `).join('');

  const statusBadgeColor: Record<InvoiceStatus, string> = {
    draft:     '#6b7280',
    sent:      '#2563eb',
    paid:      '#16a34a',
    overdue:   '#dc2626',
    cancelled: '#9ca3af',
  };
  const badgeColor = statusBadgeColor[inv.status] ?? '#6b7280';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
         font-size: 13px; color: #111827; background: #fff; }
  .page { padding: 32px 48px; max-width: 794px; margin: 0 auto; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  .workshop-name { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .workshop-meta { font-size: 12px; color: #6b7280; line-height: 1.4; }
  .invoice-title { text-align: right; }
  .invoice-title h1 { font-size: 32px; font-weight: 800; color: #7c3aed; letter-spacing: -0.5px; }
  .invoice-title .inv-number { font-size: 14px; font-weight: 600; color: #374151; margin-top: 4px; }
  .status-badge {
    display: inline-block; margin-top: 6px;
    padding: 3px 10px; border-radius: 20px;
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    color: #fff; background: ${badgeColor};
  }

  /* Divider */
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 14px 0; }

  /* Meta grid */
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-bottom: 18px; }
  .meta-block label { font-size: 10px; font-weight: 600; text-transform: uppercase;
                      letter-spacing: 0.5px; color: #9ca3af; display: block; margin-bottom: 3px; }
  .meta-block p { font-size: 13px; color: #111827; line-height: 1.35; }
  .meta-block .accent { font-weight: 700; color: #7c3aed; }

  /* Line items table */
  table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-bottom: 14px; }
  thead tr { background: #f3f4f6; }
  thead th { padding: 5px 12px; text-align: left; font-size: 11px; font-weight: 700;
             text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
  thead th:nth-child(2) { text-align: center; width: 50px; }
  thead th:nth-child(3) { text-align: right; width: 105px; }
  thead th:nth-child(4) { text-align: right; width: 105px; }
  tbody tr { border-bottom: 1px solid #f3f4f6; }
  tbody td { padding: 3px 12px; color: #374151; }
  tbody tr:last-child { border-bottom: 2px solid #e5e7eb; }

  /* Totals */
  .totals { margin-left: auto; width: 260px; }
  .totals-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; }
  .totals-row span:last-child { text-align: right; }
  .totals-row.total-final { border-top: 2px solid #7c3aed; margin-top: 4px; padding-top: 7px;
                            font-size: 16px; font-weight: 800; color: #7c3aed; }
  .totals-row.discount span:last-child { color: #16a34a; }

  /* Payment info */
  .paid-stamp { margin-top: 18px; padding: 10px 16px; background: #f0fdf4; border: 1.5px solid #86efac;
                border-radius: 8px; display: flex; align-items: center; gap: 10px; }
  .paid-stamp svg { flex-shrink: 0; }
  .paid-stamp-text { font-size: 13px; font-weight: 600; color: #15803d; }
  .paid-stamp-sub  { font-size: 11px; color: #16a34a; margin-top: 2px; }

  /* Notes */
  .notes { margin-top: 18px; padding: 10px 16px; background: #fafafa; border-radius: 8px; }
  .notes-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
                 color: #9ca3af; margin-bottom: 5px; }
  .notes-text { font-size: 13px; color: #374151; line-height: 1.4; }

  /* Footer */
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb;
            text-align: center; font-size: 11px; color: #9ca3af; }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="workshop-name">${escHtml(inv.workshop_name)}</div>
      <div class="workshop-meta">
        ${[inv.workshop_address, inv.workshop_city, inv.workshop_phone, inv.workshop_email, inv.workshop_website]
          .filter(Boolean)
          .map((line) => escHtml(line as string))
          .join('<br/>')}
      </div>
    </div>
    <div class="invoice-title">
      <h1>INVOICE</h1>
      <div class="inv-number">${escHtml(inv.invoice_number)}</div>
      <span class="status-badge">${inv.status.toUpperCase()}</span>
    </div>
  </div>

  <hr class="divider" />

  <!-- Meta -->
  <div class="meta-grid">
    <div class="meta-block">
      <label>Bill To</label>
      <p><strong>${escHtml(inv.customer_name)}</strong><br/>
      ${inv.customer_phone ? escHtml(inv.customer_phone) + '<br/>' : ''}
      ${inv.customer_email ? escHtml(inv.customer_email) + '<br/>' : ''}
      ${inv.customer_address ? escHtml(inv.customer_address) : ''}
      </p>
    </div>
    <div class="meta-block">
      <label>Vehicle</label>
      <p class="accent">${escHtml(inv.plate_number)}</p>
      <p>${escHtml(inv.make)} ${escHtml(inv.model)}${inv.year ? ' · ' + inv.year : ''}</p>
    </div>
    <div class="meta-block">
      <label>Invoice Date</label>
      <p>${formatDate(inv.created_at)}</p>
      ${inv.due_date ? `<label style="margin-top:8px">Due Date</label><p>${formatDate(inv.due_date)}</p>` : ''}
      <label style="margin-top:8px">Work Order</label>
      <p>${escHtml(inv.order_number)}</p>
    </div>
  </div>

  <!-- Line items -->
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:center">Qty</th>
        <th style="text-align:right">Unit Price</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <!-- Totals -->
  <div class="totals">
    <div class="totals-row">
      <span>Subtotal</span>
      <span>${fmt(inv.subtotal)}</span>
    </div>
    ${inv.discount > 0 ? `
    <div class="totals-row discount">
      <span>Discount</span>
      <span>− ${fmt(inv.discount)}</span>
    </div>` : ''}
    ${inv.tax_rate > 0 ? `
    <div class="totals-row">
      <span>${escHtml(inv.tax_label)} (${inv.tax_rate}%)</span>
      <span>${fmt(inv.tax_amount)}</span>
    </div>` : ''}
    <div class="totals-row total-final">
      <span>Total</span>
      <span>${fmt(inv.total)}</span>
    </div>
  </div>

  <!-- Paid stamp -->
  ${inv.status === 'paid' ? `
  <div class="paid-stamp">
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#16a34a" stroke-width="2.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
    <div>
      <div class="paid-stamp-text">Payment Received</div>
      ${inv.paid_at ? `<div class="paid-stamp-sub">${formatDate(inv.paid_at)} · ${(inv.payment_method ?? '').replace('_', ' ')}${inv.payment_reference ? ` · Ref: ${inv.payment_reference}` : ''}</div>` : ''}
    </div>
  </div>` : ''}

  <!-- Notes -->
  ${inv.notes ? `
  <div class="notes">
    <div class="notes-label">Notes</div>
    <div class="notes-text">${escHtml(inv.notes)}</div>
  </div>` : ''}

  <!-- Customer complaint -->
  ${inv.customer_complaint ? `
  <div class="notes" style="margin-top:12px">
    <div class="notes-label">Customer Complaint</div>
    <div class="notes-text">${escHtml(inv.customer_complaint)}</div>
  </div>` : ''}

  <div class="footer">Thank you for your business · ${escHtml(inv.workshop_name)}</div>
</div>
</body>
</html>`;
}

function escHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;
