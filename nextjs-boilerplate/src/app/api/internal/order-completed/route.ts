/**
 * POST /api/internal/order-completed
 *
 * Volá se z mock GoPay webhooku po úspěšné platbě.
 * Pošle confirmation e-mail (do Mailhogu na localhost:1025).
 *
 * Auth: x-internal-token header musí odpovídat INTERNAL_SERVICE_TOKEN.
 * Idempotent: ok zavolat opakovaně.
 *
 * Body: { orderId: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';

import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';
import { renderTicketsPdf } from '@/lib/tickets/pdf-renderer';
import { sendSms } from '@/lib/sms/bulkgate-mock';
import { escapeHtml } from '@/lib/html-escape/escape';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface OrderRow {
  id: string;
  status: string;
  total_amount: number;
  currency: string;
  paid_at: string | null;
  buyer_email: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  event_title: string;
  event_date_start: string;
  venue_name: string | null;
}

interface ItemRow {
  ticket_type_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

function formatCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} Kč`;
}

function buildEmailHtml(order: OrderRow, items: ItemRow[]): string {
  const itemsRows = items
    .map(
      (it) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(it.ticket_type_name)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.quantity}×</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCzk(it.unit_price)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCzk(it.total_price)}</td>
        </tr>`,
    )
    .join('');

  const dateStart = new Date(order.event_date_start).toLocaleString('cs-CZ', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
  <h1 style="color:#10b981">Děkujeme za nákup!</h1>
  <p>Tvá objednávka byla zaplacena. Lístky najdeš v účtu na Tixly.</p>

  <h2 style="margin-top:32px">${escapeHtml(order.event_title)}</h2>
  <p style="color:#666;margin:4px 0">📅 ${escapeHtml(dateStart)}</p>
  <p style="color:#666;margin:4px 0">📍 ${escapeHtml(order.venue_name ?? 'Online / TBD')}</p>

  <table style="width:100%;border-collapse:collapse;margin-top:24px">
    <thead>
      <tr style="background:#f5f5f5">
        <th style="padding:8px;text-align:left">Typ</th>
        <th style="padding:8px;text-align:center">Počet</th>
        <th style="padding:8px;text-align:right">Cena/ks</th>
        <th style="padding:8px;text-align:right">Celkem</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="padding:12px 8px;text-align:right;font-weight:600">Celkem k úhradě:</td>
        <td style="padding:12px 8px;text-align:right;font-weight:700;font-size:18px">${formatCzk(order.total_amount)}</td>
      </tr>
    </tfoot>
  </table>

  <p style="margin-top:32px;color:#666;font-size:13px">
    Číslo objednávky: <code>${escapeHtml(order.id)}</code><br/>
    Tixly Demo · vstupenky@tixly.local
  </p>
</body></html>`;
}

export async function POST(request: NextRequest): Promise<Response> {
  const token = request.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { orderId?: string } | null;
  const orderId = body?.orderId;
  if (!orderId) {
    return NextResponse.json({ error: 'orderId required' }, { status: 422 });
  }

  // Načti objednávku + položky + akci + místo
  const orderRes = await db().query<OrderRow>(
    `SELECT
       o.id, o.status, o.total_amount, o.currency, o.paid_at,
       u.email AS buyer_email, u.name AS buyer_name, u.phone AS buyer_phone,
       e.title AS event_title, e.date_start AS event_date_start,
       v.name AS venue_name
     FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     LEFT JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE o.id = $1`,
    [orderId],
  );
  if (orderRes.rows.length === 0) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  const order = orderRes.rows[0]!;
  if (order.status !== 'paid') {
    return NextResponse.json(
      { skipped: true, reason: `order status is ${order.status}, not paid` },
      { status: 200 },
    );
  }

  const itemsRes = await db().query<ItemRow>(
    `SELECT
       tt.name AS ticket_type_name,
       oi.quantity, oi.unit_price, oi.total_price
     FROM orders.order_items oi
     JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
     WHERE oi.order_id = $1
     ORDER BY oi.created_at`,
    [orderId],
  );

  // Confirm pending addons → confirmed
  await db().query(
    `UPDATE public.order_addons SET status = 'confirmed'
     WHERE order_id = $1 AND status = 'pending'`,
    [orderId],
  );

  const html = buildEmailHtml(order, itemsRes.rows);

  // Issue tickets + render PDF attachment.
  // Failures here must NOT block the email (best-effort) — order is already paid.
  let ticketsIssued = 0;
  let pdfAttachment: { filename: string; content: Buffer } | undefined;
  try {
    const issued = await issueTicketsForOrder(orderId, db());
    ticketsIssued = issued.length;
    // Skip PDF when this is a duplicate call (existing tickets have empty secrets)
    const hasFreshSecrets = issued.every((t) => t.totpSecretBase32.length > 0);
    // Fire-and-forget conversion tracking (Q.2) — Meta CAPI + GA4
    if (hasFreshSecrets) {
      void fireConversionTracking(orderId).catch((err) =>
        console.error('[order-completed] conversion tracking failed', err),
      );
    }

    if (issued.length > 0 && hasFreshSecrets) {
      const pdfBuf = await renderTicketsPdf(
        {
          eventTitle: order.event_title,
          eventDateStart: order.event_date_start,
          venueName: order.venue_name,
          buyerName: order.buyer_name ?? order.buyer_email,
          buyerEmail: order.buyer_email,
          orderId: order.id,
        },
        issued.map((t) => ({
          ticketId: t.ticketId,
          ticketTypeName: t.ticketTypeName,
          totpSecretBase32: t.totpSecretBase32,
          holderLabel: order.buyer_email,
          issuer: order.event_title,
        })),
      );
      pdfAttachment = { filename: `tixly-${order.id.slice(0, 8)}.pdf`, content: pdfBuf };
    }
  } catch (err) {
    console.error('[order-completed] ticket issue / PDF failed:', err);
  }

  // Odešli e-mail přes nodemailer (Mailhog na localhost:1025)
  let emailSent = false;
  try {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? '1025'),
      secure: false,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      tls: { rejectUnauthorized: false },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM ?? 'vstupenky@tixly.local',
      to: order.buyer_email,
      subject: `Tixly — vstupenky na ${order.event_title}`,
      html,
      attachments: pdfAttachment ? [pdfAttachment] : undefined,
    });
    emailSent = true;
  } catch (err) {
    console.error('[order-completed] email failed:', err);
  }

  // SMS confirmation (volitelné — pokud kupec poskytl telefon)
  let smsSent = false;
  if (order.buyer_phone) {
    const smsText = `Tixly: ${order.event_title.slice(0, 40)} — ${ticketsIssued} vstupenek (${formatCzk(order.total_amount)}). Detail v emailu.`;
    const r = await sendSms(
      { to: order.buyer_phone, text: smsText, orderId: order.id },
      db(),
    );
    smsSent = r.ok;
    if (!r.ok) {
      console.warn('[order-completed] SMS failed:', r.reason);
    }
  }

  return NextResponse.json({
    success: true,
    orderId,
    emailSent,
    smsSent,
    items: itemsRes.rows.length,
    ticketsIssued,
    pdfAttached: pdfAttachment !== undefined,
  });
}

async function fireConversionTracking(orderId: string): Promise<void> {
  const r = await db().query<{
    event_id: string;
    total_amount: number;
    currency: string;
    buyer_email: string;
    event_title: string;
    meta_pixel_id: string | null;
    meta_capi_token: string | null;
    ga4_measurement_id: string | null;
    ga4_api_secret: string | null;
    items: { ticket_type_id: string; name: string; quantity: number; unit_price: number }[];
  }>(
    `SELECT o.event_id, o.total_amount, o.currency,
            u.email AS buyer_email,
            e.title AS event_title,
            e.meta_pixel_id, e.meta_capi_token,
            e.ga4_measurement_id, e.ga4_api_secret,
            (SELECT json_agg(json_build_object(
              'ticket_type_id', oi.ticket_type_id,
              'name', tt.name,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price
            )) FROM orders.order_items oi
              JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
              WHERE oi.order_id = o.id) AS items
     FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     JOIN catalog.events e ON e.id = o.event_id
     WHERE o.id = $1`,
    [orderId],
  );
  if (r.rows.length === 0) return;
  const o = r.rows[0]!;
  const valueMajor = o.total_amount / 100;
  const items = o.items ?? [];

  if (o.meta_pixel_id && o.meta_capi_token) {
    const { sendMetaEvent } = await import('@/lib/tracking/meta-capi');
    await sendMetaEvent(
      {
        eventName: 'Purchase',
        eventTime: Math.floor(Date.now() / 1000),
        eventId: orderId,
        pixelId: o.meta_pixel_id,
        capiToken: o.meta_capi_token,
        email: o.buyer_email,
        value: valueMajor,
        currency: o.currency,
        contentIds: items.map((i) => i.ticket_type_id),
        contentName: o.event_title,
        contentType: 'product',
        numItems: items.reduce((s, i) => s + i.quantity, 0),
        sourceUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/cs/events/${o.event_id}`,
      },
      { eventId: o.event_id, orderId },
    );
  }

  if (o.ga4_measurement_id && o.ga4_api_secret) {
    const { sendGA4Event } = await import('@/lib/tracking/ga4');
    await sendGA4Event(
      {
        measurementId: o.ga4_measurement_id,
        apiSecret: o.ga4_api_secret,
        clientId: orderId, // server-side, no browser fingerprint — use order id as fallback
        eventName: 'purchase',
        params: {
          transaction_id: orderId,
          value: valueMajor,
          currency: o.currency,
          items: items.map((i) => ({
            item_id: i.ticket_type_id,
            item_name: i.name,
            price: i.unit_price / 100,
            quantity: i.quantity,
            item_category: o.event_title,
          })),
        },
      },
      { eventId: o.event_id, orderId },
    );
  }
}
