import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// ---------------------------------------------------------------------------
// S3 client (lazy — only initialised when env vars are present)
// ---------------------------------------------------------------------------

function getS3Client() {
  const region = process.env.AWS_REGION;
  const key    = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !key || !secret) {
    throw new Error('AWS credentials not configured');
  }
  return new S3Client({ region, credentials: { accessKeyId: key, secretAccessKey: secret } });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data, error: null });
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ data: null, error: { message } });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  try {
    const result = await pool.query(
      `SELECT id, name, phone, phone2, address, city, logo_url,
              email, website, payment_instructions,
              currency, tax_label, tax_rate::float, tax_enabled,
              invoice_prefix, order_prefix, owner_email
       FROM workshops WHERE id = $1`,
      [workshopId],
    );
    if (result.rows.length === 0) { fail(res, 404, 'Workshop not found'); return; }
    ok(res, result.rows[0]);
  } catch (err) {
    console.error('Get settings error:', err);
    fail(res, 500, 'Failed to load settings');
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  name:           z.string().min(1).optional(),
  phone:          z.string().optional(),
  phone2:         z.string().optional(),
  address:        z.string().optional(),
  city:           z.string().optional(),
  email:          z.string().email('Invalid email').optional().or(z.literal('')),
  website:        z.string().optional(),
  payment_instructions: z.string().max(500).optional(),
  currency:       z.string().optional(),
  tax_label:      z.string().optional(),
  tax_rate:       z.number().nonnegative().max(100).optional(),
  tax_enabled:    z.boolean().optional(),
  invoice_prefix: z.string().min(1).max(10).optional(),
  order_prefix:   z.string().min(1).max(10).optional(),
});

router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Validation failed'); return; }

  const d = parsed.data;
  const fields: string[] = [];
  const values: unknown[] = [workshopId];

  const set = (col: string, val: unknown) => {
    if (val === undefined) return;
    values.push(val === '' ? null : val);
    fields.push(`${col} = $${values.length}`);
  };

  set('name',           d.name);
  set('phone',          d.phone);
  set('phone2',         d.phone2);
  set('address',        d.address);
  set('city',           d.city);
  set('email',          d.email);
  set('website',        d.website);
  set('payment_instructions', d.payment_instructions);
  set('currency',       d.currency);
  set('tax_label',      d.tax_label);
  set('tax_rate',       d.tax_rate);
  set('tax_enabled',    d.tax_enabled);
  set('invoice_prefix', d.invoice_prefix);
  set('order_prefix',   d.order_prefix);

  if (fields.length === 0) { fail(res, 400, 'No fields to update'); return; }

  try {
    const result = await pool.query(
      `UPDATE workshops SET ${fields.join(', ')}, updated_at = now()
       WHERE id = $1
       RETURNING id, name, phone, phone2, address, city, logo_url,
                 email, website, payment_instructions,
                 currency, tax_label, tax_rate::float, tax_enabled,
                 invoice_prefix, order_prefix, owner_email`,
      values,
    );
    ok(res, result.rows[0]);
  } catch (err) {
    console.error('Update settings error:', err);
    fail(res, 500, 'Failed to update settings');
  }
});

// ---------------------------------------------------------------------------
// POST /api/settings/logo/presign
// Returns a presigned S3 PUT URL + the final public URL the client stores
// ---------------------------------------------------------------------------

const presignSchema = z.object({
  contentType: z.string().regex(/^image\/(jpeg|png|webp|gif|svg\+xml)$/),
  fileName:    z.string().min(1).max(200),
});

router.post('/logo/presign', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const parsed = presignSchema.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'Invalid content type or file name'); return; }

  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) { fail(res, 500, 'S3 bucket not configured'); return; }

  try {
    const wsResult = await pool.query('SELECT name FROM workshops WHERE id = $1', [workshopId]);
    if (wsResult.rows.length === 0) { fail(res, 404, 'Workshop not found'); return; }

    const slug = slugify(wsResult.rows[0].name) || workshopId;
    const ext  = parsed.data.fileName.split('.').pop() ?? 'jpg';
    const key  = `branding/garagesys/${slug}/logo-${Date.now()}.${ext}`;

    const s3 = getS3Client();
    const command = new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      ContentType: parsed.data.contentType,
    });
    const uploadUrl  = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicUrl  = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    ok(res, { uploadUrl, publicUrl });
  } catch (err) {
    console.error('Presign error:', err);
    fail(res, 500, (err as Error).message ?? 'Failed to generate upload URL');
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/logo  — commit the logo_url after S3 upload
// ---------------------------------------------------------------------------

router.patch('/logo', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { workshopId } = req.user!;
  const { logoUrl } = req.body ?? {};
  if (typeof logoUrl !== 'string' || !logoUrl.startsWith('https://')) {
    fail(res, 400, 'Invalid logo URL'); return;
  }
  try {
    const result = await pool.query(
      `UPDATE workshops SET logo_url = $1, updated_at = now()
       WHERE id = $2 RETURNING logo_url`,
      [logoUrl, workshopId],
    );
    ok(res, result.rows[0]);
  } catch (err) {
    console.error('Logo update error:', err);
    fail(res, 500, 'Failed to update logo');
  }
});

export default router;
