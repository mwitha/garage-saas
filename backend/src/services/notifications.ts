import twilio from 'twilio';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { SentMessageInfo } from 'nodemailer/lib/smtp-transport';
import { pool } from '../db/pool';

// ---------------------------------------------------------------------------
// Provider clients (lazy — missing env vars throw at call time, not import)
// ---------------------------------------------------------------------------

function getTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  return twilio(sid, token);
}

function getMailTransporter(): Transporter<SentMessageInfo> {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ---------------------------------------------------------------------------
// Notification log helpers
// ---------------------------------------------------------------------------

async function logPending(params: {
  workshopId:  string;
  customerId:  string;
  workOrderId?: string | null;
  type:        string;
  channel:     string;
  recipient:   string;
  message:     string;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO notifications
       (workshop_id, customer_id, work_order_id, type, channel, status, recipient, message)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
     RETURNING id`,
    [
      params.workshopId,
      params.customerId,
      params.workOrderId ?? null,
      params.type,
      params.channel,
      params.recipient,
      params.message,
    ],
  );
  return rows[0].id;
}

async function markSent(notifId: string, externalId?: string | null): Promise<void> {
  await pool.query(
    `UPDATE notifications
     SET status = 'sent', external_id = $2, sent_at = NOW()
     WHERE id = $1`,
    [notifId, externalId ?? null],
  );
}

async function markFailed(notifId: string, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE notifications
     SET status = 'failed', error_message = $2
     WHERE id = $1`,
    [notifId, errorMessage],
  );
}

// ---------------------------------------------------------------------------
// sendJobReadySMS
// Triggered when a work order transitions to status = 'ready'.
// ---------------------------------------------------------------------------

export async function sendJobReadySMS(
  customerId: string,
  workOrderId: string,
): Promise<void> {
  const { rows } = await pool.query<{
    customer_name: string;
    customer_phone: string;
    workshop_id: string;
    make: string; model: string; plate_number: string;
    order_number: string;
    workshop_name: string; workshop_phone: string | null;
  }>(
    `SELECT
       c.name         AS customer_name,
       c.phone        AS customer_phone,
       c.workshop_id,
       v.make, v.model, v.plate_number,
       wo.order_number,
       w.name         AS workshop_name,
       w.phone        AS workshop_phone
     FROM work_orders wo
     JOIN vehicles  v ON v.id  = wo.vehicle_id
     JOIN customers c ON c.id  = v.customer_id
     JOIN workshops w ON w.id  = wo.workshop_id
     WHERE wo.id = $1 AND v.customer_id = $2`,
    [workOrderId, customerId],
  );

  if (rows.length === 0) throw new Error('Work order or customer not found');
  const r = rows[0];

  if (!r.customer_phone) throw new Error('Customer has no phone number');

  const body =
    `Hi ${r.customer_name}, your ${r.make} ${r.model} (${r.plate_number}) ` +
    `is ready for collection at ${r.workshop_name}. Ref: ${r.order_number}.` +
    (r.workshop_phone ? ` Call us: ${r.workshop_phone}` : '');

  const notifId = await logPending({
    workshopId:  r.workshop_id,
    customerId,
    workOrderId,
    type:        'job_ready',
    channel:     'sms',
    recipient:   r.customer_phone,
    message:     body,
  });

  try {
    const client = getTwilioClient();
    const result = await client.messages.create({
      body,
      from: process.env.TWILIO_FROM_NUMBER!,
      to:   r.customer_phone,
    });
    await markSent(notifId, result.sid);
    console.info(`[notifications] SMS sent to ${r.customer_phone}, SID=${result.sid}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(notifId, msg);
    console.error(`[notifications] SMS failed for WO ${workOrderId}:`, msg);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// sendServiceReminderSMS
// Call manually (e.g. from a scheduled job or admin action).
// ---------------------------------------------------------------------------

export async function sendServiceReminderSMS(
  customerId: string,
  vehicleId: string,
): Promise<void> {
  const { rows } = await pool.query<{
    customer_name: string;
    customer_phone: string;
    workshop_id: string;
    make: string; model: string; plate_number: string;
    workshop_name: string; workshop_phone: string | null;
  }>(
    `SELECT
       c.name        AS customer_name,
       c.phone       AS customer_phone,
       v.workshop_id,
       v.make, v.model, v.plate_number,
       w.name        AS workshop_name,
       w.phone       AS workshop_phone
     FROM vehicles  v
     JOIN customers c ON c.id = v.customer_id
     JOIN workshops w ON w.id = v.workshop_id
     WHERE v.id = $1 AND v.customer_id = $2`,
    [vehicleId, customerId],
  );

  if (rows.length === 0) throw new Error('Vehicle or customer not found');
  const r = rows[0];

  if (!r.customer_phone) throw new Error('Customer has no phone number');

  const body =
    `Hi ${r.customer_name}, this is a service reminder from ${r.workshop_name}. ` +
    `Your ${r.make} ${r.model} (${r.plate_number}) is due for a service. ` +
    (r.workshop_phone
      ? `Please call ${r.workshop_phone} to book an appointment.`
      : 'Please visit us to book an appointment.');

  const notifId = await logPending({
    workshopId:  r.workshop_id,
    customerId,
    workOrderId: null,
    type:        'service_reminder',
    channel:     'sms',
    recipient:   r.customer_phone,
    message:     body,
  });

  try {
    const client = getTwilioClient();
    const result = await client.messages.create({
      body,
      from: process.env.TWILIO_FROM_NUMBER!,
      to:   r.customer_phone,
    });
    await markSent(notifId, result.sid);
    console.info(`[notifications] Service reminder SMS sent to ${r.customer_phone}, SID=${result.sid}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(notifId, msg);
    console.error(`[notifications] Service reminder SMS failed for vehicle ${vehicleId}:`, msg);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// sendInvoiceEmail
// Triggered after invoice creation. Renders a full HTML invoice email.
// ---------------------------------------------------------------------------

export async function sendInvoiceEmail(
  invoiceId: string,
  options?: { isReminder?: boolean },
): Promise<void> {
  const isReminder = options?.isReminder ?? false;
  // Fetch invoice + customer + vehicle + workshop in one query
  const { rows } = await pool.query<{
    invoice_number: string;
    subtotal: number; tax_rate: number; tax_amount: number;
    discount: number; total: number;
    status: string; due_date: string | null; notes: string | null; warranty_months: number | null;
    customer_id: string;
    customer_name: string; customer_email: string | null; customer_phone: string | null;
    make: string; model: string; plate_number: string;
    order_number: string;
    workshop_id: string;
    workshop_name: string; workshop_phone: string | null;
    workshop_address: string | null; workshop_city: string | null;
    currency: string;
  }>(
    `SELECT
       i.invoice_number,
       i.subtotal::float, i.tax_rate::float, i.tax_amount::float,
       i.discount::float, i.total::float,
       i.status, i.due_date, i.notes, i.warranty_months,
       c.id           AS customer_id,
       c.name         AS customer_name,
       c.email        AS customer_email,
       c.phone        AS customer_phone,
       v.make, v.model, v.plate_number,
       wo.order_number,
       w.id           AS workshop_id,
       w.name         AS workshop_name,
       w.phone        AS workshop_phone,
       w.address      AS workshop_address,
       w.city         AS workshop_city,
       w.currency
     FROM invoices   i
     JOIN work_orders wo ON wo.id = i.work_order_id
     JOIN vehicles    v  ON v.id  = wo.vehicle_id
     JOIN customers   c  ON c.id  = v.customer_id
     JOIN workshops   w  ON w.id  = i.workshop_id
     WHERE i.id = $1`,
    [invoiceId],
  );

  if (rows.length === 0) throw new Error('Invoice not found');
  const inv = rows[0];

  if (!inv.customer_email) throw new Error('Customer has no email address');

  // Line items
  const { rows: items } = await pool.query<{
    description: string; quantity: number; unit_price: number; line_total: number;
  }>(
    `SELECT description, quantity::float, unit_price::float, line_total::float
     FROM invoice_items
     WHERE invoice_id = $1
     ORDER BY sort_order, id`,
    [invoiceId],
  );

  const currency = inv.currency ?? 'LKR';
  const fmt = (n: number) => `${currency} ${Math.round(n).toLocaleString('en-US')}`;

  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;">${escapeHtml(item.description)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;font-size:13px;">${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-size:13px;">${fmt(item.unit_price)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-size:13px;font-weight:600;">${fmt(item.line_total)}</td>
    </tr>`).join('');

  const dueDateStr = inv.due_date
    ? new Date(inv.due_date).toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const html = buildInvoiceHtml({
    workshopName:    inv.workshop_name,
    workshopAddress: inv.workshop_address,
    workshopCity:    inv.workshop_city,
    workshopPhone:   inv.workshop_phone,
    customerName:    inv.customer_name,
    customerPhone:   inv.customer_phone,
    invoiceNumber:   inv.invoice_number,
    dueDateStr,
    make: inv.make, model: inv.model, plateNumber: inv.plate_number,
    orderNumber:     inv.order_number,
    itemRows,
    subtotal:        inv.subtotal,
    discount:        inv.discount,
    taxRate:         inv.tax_rate,
    taxAmount:       inv.tax_amount,
    total:           inv.total,
    notes:           inv.notes,
    warrantyMonths:  inv.warranty_months,
    fmt,
    isReminder,
  });

  const subject = isReminder
    ? `Payment Reminder: Invoice ${inv.invoice_number} – ${inv.make} ${inv.model} (${inv.plate_number})`
    : `Invoice ${inv.invoice_number} – ${inv.make} ${inv.model} (${inv.plate_number})`;
  const snippet = `${inv.workshop_name} · Invoice ${inv.invoice_number} · ${fmt(inv.total)}`;

  const notifId = await logPending({
    workshopId:  inv.workshop_id,
    customerId:  inv.customer_id,
    workOrderId: null,
    type:        'invoice_sent',
    channel:     'email',
    recipient:   inv.customer_email,
    message:     snippet,
  });

  try {
    const transporter = getMailTransporter();
    const result = await transporter.sendMail({
      from:    process.env.SMTP_FROM ?? `${inv.workshop_name} <${process.env.SMTP_USER}>`,
      to:      inv.customer_email,
      subject,
      html,
    });
    await markSent(notifId, result.messageId ?? null);
    console.info(`[notifications] Invoice email sent to ${inv.customer_email}, msgId=${result.messageId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(notifId, msg);
    console.error(`[notifications] Invoice email failed for invoice ${invoiceId}:`, msg);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildInvoiceHtml(p: {
  workshopName: string; workshopAddress: string | null; workshopCity: string | null; workshopPhone: string | null;
  customerName: string; customerPhone: string | null;
  invoiceNumber: string; dueDateStr: string | null;
  make: string; model: string; plateNumber: string; orderNumber: string;
  itemRows: string;
  subtotal: number; discount: number; taxRate: number; taxAmount: number; total: number;
  notes: string | null;
  warrantyMonths: number | null;
  fmt: (n: number) => string;
  isReminder?: boolean;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Invoice ${escapeHtml(p.invoiceNumber)}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

      ${p.isReminder ? `
      <!-- Reminder banner -->
      <tr>
        <td style="background:#fef3c7;padding:14px 32px;border-bottom:1px solid #fde68a;">
          <p style="margin:0;font-size:13px;font-weight:600;color:#92400e;">
            Friendly reminder — payment for the invoice below is still outstanding.
          </p>
        </td>
      </tr>` : ''}

      <!-- Header -->
      <tr>
        <td style="background:#7c3aed;padding:28px 32px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#fff;">${escapeHtml(p.workshopName)}</p>
          ${p.workshopAddress ? `<p style="margin:6px 0 0;font-size:13px;color:#ddd6fe;">${escapeHtml(p.workshopAddress)}${p.workshopCity ? ', ' + escapeHtml(p.workshopCity) : ''}</p>` : ''}
          ${p.workshopPhone  ? `<p style="margin:4px 0 0;font-size:13px;color:#ddd6fe;">${escapeHtml(p.workshopPhone)}</p>` : ''}
        </td>
      </tr>

      <!-- Bill-to + Invoice meta -->
      <tr>
        <td style="padding:28px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="50%" valign="top">
                <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;">Bill To</p>
                <p style="margin:0;font-weight:600;font-size:15px;color:#111;">${escapeHtml(p.customerName)}</p>
                ${p.customerPhone ? `<p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${escapeHtml(p.customerPhone)}</p>` : ''}
              </td>
              <td width="50%" valign="top" align="right">
                <p style="margin:0;font-size:24px;font-weight:800;color:#7c3aed;letter-spacing:-.5px;">INVOICE</p>
                <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#374151;">#${escapeHtml(p.invoiceNumber)}</p>
                ${p.dueDateStr ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Due: ${escapeHtml(p.dueDateStr)}</p>` : ''}
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;padding:10px 0;border-top:1px solid #f3f4f6;">
            Vehicle: <strong style="color:#374151;">${escapeHtml(p.make)} ${escapeHtml(p.model)}</strong>
            &nbsp;·&nbsp;${escapeHtml(p.plateNumber)}
            &nbsp;·&nbsp;Ref: ${escapeHtml(p.orderNumber)}
          </p>
        </td>
      </tr>

      <!-- Line items table -->
      <tr>
        <td style="padding:20px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;font-weight:600;">Description</th>
                <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;font-weight:600;width:60px;">Qty</th>
                <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;font-weight:600;width:120px;">Unit Price</th>
                <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;font-weight:600;width:120px;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${p.itemRows}
            </tbody>
          </table>
        </td>
      </tr>

      <!-- Totals -->
      <tr>
        <td style="padding:16px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td width="60%"></td><td width="40%">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:5px 0;font-size:13px;color:#6b7280;">Subtotal</td>
                  <td style="padding:5px 0;font-size:13px;text-align:right;color:#374151;">${p.fmt(p.subtotal)}</td>
                </tr>
                ${p.discount > 0 ? `<tr><td style="padding:5px 0;font-size:13px;color:#6b7280;">Discount</td><td style="padding:5px 0;font-size:13px;text-align:right;color:#374151;">-${p.fmt(p.discount)}</td></tr>` : ''}
                ${p.taxAmount > 0 ? `<tr><td style="padding:5px 0;font-size:13px;color:#6b7280;">Tax (${p.taxRate}%)</td><td style="padding:5px 0;font-size:13px;text-align:right;color:#374151;">${p.fmt(p.taxAmount)}</td></tr>` : ''}
                <tr style="border-top:2px solid #e5e7eb;">
                  <td style="padding:10px 0 5px;font-size:16px;font-weight:700;color:#111;">Total Due</td>
                  <td style="padding:10px 0 5px;font-size:16px;font-weight:700;text-align:right;color:#7c3aed;">${p.fmt(p.total)}</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td>
      </tr>

      <!-- Notes -->
      ${p.notes ? `<tr><td style="padding:20px 32px 0;"><p style="margin:0;padding:14px 16px;background:#f9fafb;border-radius:8px;font-size:13px;color:#6b7280;border:1px solid #f3f4f6;">${escapeHtml(p.notes)}</p></td></tr>` : ''}

      <!-- Warranty -->
      ${p.warrantyMonths ? `<tr><td style="padding:16px 32px 0;"><p style="margin:0;font-size:12px;font-weight:600;color:#7c3aed;">${p.warrantyMonths} months warranty for the replacement parts</p></td></tr>` : ''}

      <!-- Footer -->
      <tr>
        <td style="padding:28px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#d1d5db;">Thank you for your business.</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
