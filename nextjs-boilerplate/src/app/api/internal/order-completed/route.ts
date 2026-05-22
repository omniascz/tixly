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

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

import { escapeHtml } from '@/lib/html-escape/escape';
import { sendSms } from '@/lib/sms/bulkgate-mock';
import { resolveVatRate, splitGrossToNetVat } from '@/lib/tax/vat-rates';
import { awardPointsForOrder } from '@/lib/loyalty/engine';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';
import { renderTicketsPdf } from '@/lib/tickets/pdf-renderer';

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
  user_id: string;
  status: string;
  total_amount: number;
  currency: string;
  paid_at: string | null;
  buyer_email: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  event_title: string;
  event_date_start: string;
  event_qr_policy: string;
  event_vat_category: string | null;
  venue_name: string | null;
  promoter_name: string | null;
  promoter_email: string | null;
  promoter_country: string | null;
  brand_color_hex: string | null;
  brand_logo_url: string | null;
  promoter_vat_rate_pct: number | null;
}

interface ItemRow {
  ticket_type_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

function formatMoney(halire: number, currency: string, locale: string): string {
  const amount = (halire / 100).toLocaleString(locale === 'sk' ? 'sk-SK' : 'cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const suffix = currency === 'EUR' ? ' €' : ' Kč';
  return amount + suffix;
}

function formatCzk(halire: number): string {
  return formatMoney(halire, 'CZK', 'cs');
}

interface EmailStrings {
  thanksTitle: string;
  thanksLead: string;
  typeHeader: string;
  qtyHeader: string;
  unitPriceHeader: string;
  totalHeader: string;
  netLabel: string;
  vatLabel: (pct: number) => string;
  totalLabel: string;
  orderNumberLabel: string;
  senderLabel: string;
  footer: string;
}

const EMAIL_STRINGS: Record<'cs' | 'sk' | 'en', EmailStrings> = {
  cs: {
    thanksTitle: 'Děkujeme za nákup!',
    thanksLead: 'Tvá objednávka byla zaplacena. Lístky najdeš v příloze této zprávy a také v účtu na Tixly.',
    typeHeader: 'Typ',
    qtyHeader: 'Počet',
    unitPriceHeader: 'Cena/ks',
    totalHeader: 'Celkem',
    netLabel: 'Základ daně:',
    vatLabel: (pct) => `DPH ${pct} %:`,
    totalLabel: 'Celkem k úhradě:',
    orderNumberLabel: 'Číslo objednávky',
    senderLabel: 'Odesílatel',
    footer: 'Lístky vystaveny přes platformu Tixly.',
  },
  sk: {
    thanksTitle: 'Ďakujeme za nákup!',
    thanksLead: 'Tvoja objednávka bola zaplatená. Lístky nájdeš v prílohe tejto správy a tiež v účte na Tixly.',
    typeHeader: 'Typ',
    qtyHeader: 'Počet',
    unitPriceHeader: 'Cena/ks',
    totalHeader: 'Spolu',
    netLabel: 'Základ dane:',
    vatLabel: (pct) => `DPH ${pct} %:`,
    totalLabel: 'Spolu k úhrade:',
    orderNumberLabel: 'Č. objednávky',
    senderLabel: 'Odosielateľ',
    footer: 'Lístky vystavené cez platformu Tixly.',
  },
  en: {
    thanksTitle: 'Thanks for your purchase!',
    thanksLead: 'Your order has been paid. Tickets are attached to this email and also in your Tixly account.',
    typeHeader: 'Type',
    qtyHeader: 'Qty',
    unitPriceHeader: 'Unit price',
    totalHeader: 'Total',
    netLabel: 'Net:',
    vatLabel: (pct) => `VAT ${pct} %:`,
    totalLabel: 'Total to pay:',
    orderNumberLabel: 'Order #',
    senderLabel: 'Sender',
    footer: 'Tickets issued via Tixly platform.',
  },
};

function pickEmailLocale(order: OrderRow): 'cs' | 'sk' | 'en' {
  const orderLocale = (order as { locale?: string }).locale;
  if (orderLocale === 'sk') return 'sk';
  if (orderLocale === 'en') return 'en';
  if (order.promoter_country === 'SR') return 'sk';
  return 'cs';
}

function buildEmailHtml(order: OrderRow, items: ItemRow[]): string {
  const locale = pickEmailLocale(order);
  const s = EMAIL_STRINGS[locale];
  const currency = order.currency || 'CZK';
  const fmt = (h: number) => formatMoney(h, currency, locale);

  const itemsRows = items
    .map(
      (it) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(it.ticket_type_name)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.quantity}×</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(it.unit_price)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(it.total_price)}</td>
        </tr>`,
    )
    .join('');

  const dateLocale = locale === 'sk' ? 'sk-SK' : locale === 'en' ? 'en-GB' : 'cs-CZ';
  const dateStart = new Date(order.event_date_start).toLocaleString(dateLocale, {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  // Brand color: pokud promotér nemá vyplněno, fallback Tixly green.
  const brandColor =
    order.brand_color_hex && /^#[0-9a-f]{6}$/i.test(order.brand_color_hex)
      ? order.brand_color_hex
      : '#10b981';
  const promoterName = order.promoter_name ?? 'Tixly';
  const senderLine = order.promoter_email
    ? `${escapeHtml(promoterName)} · ${escapeHtml(order.promoter_email)}`
    : `${escapeHtml(promoterName)} přes Tixly`;

  // DPH rozpis (gross → net + dph). Per-event vat_category > promoter flat rate.
  // SK + cultural = 5 %, CZ + cultural = 10 %, atd.
  const vatRatePct = order.event_vat_category
    ? resolveVatRate({
        country: order.promoter_country,
        vatCategory: order.event_vat_category,
      })
    : (order.promoter_vat_rate_pct ?? 10);
  const { netHalire, vatHalire } = splitGrossToNetVat(order.total_amount, vatRatePct);

  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:0;color:#111">
  <div style="background:${brandColor};color:#fff;padding:24px;text-align:center">
    ${order.brand_logo_url ? `<img src="${escapeHtml(order.brand_logo_url)}" alt="${escapeHtml(promoterName)}" style="height:48px;background:#fff;padding:4px;border-radius:4px"/>` : ''}
    <h1 style="margin:16px 0 4px;font-size:24px">${s.thanksTitle}</h1>
    <p style="margin:0;opacity:0.9">${escapeHtml(promoterName)}</p>
  </div>

  <div style="padding:24px">
    <p>${s.thanksLead}</p>

    <h2 style="margin-top:24px;color:${brandColor}">${escapeHtml(order.event_title)}</h2>
    <p style="color:#666;margin:4px 0">📅 ${escapeHtml(dateStart)}</p>
    <p style="color:#666;margin:4px 0">📍 ${escapeHtml(order.venue_name ?? 'Online / TBD')}</p>

    <table style="width:100%;border-collapse:collapse;margin-top:24px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left">${s.typeHeader}</th>
          <th style="padding:8px;text-align:center">${s.qtyHeader}</th>
          <th style="padding:8px;text-align:right">${s.unitPriceHeader}</th>
          <th style="padding:8px;text-align:right">${s.totalHeader}</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <tr>
        <td style="padding:4px 8px;text-align:right;color:#666;font-size:13px">${s.netLabel}</td>
        <td style="padding:4px 8px;text-align:right;width:120px">${fmt(netHalire)}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;text-align:right;color:#666;font-size:13px">${s.vatLabel(vatRatePct)}</td>
        <td style="padding:4px 8px;text-align:right">${fmt(vatHalire)}</td>
      </tr>
      <tr style="border-top:2px solid #111">
        <td style="padding:8px;text-align:right;font-weight:600">${s.totalLabel}</td>
        <td style="padding:8px;text-align:right;font-weight:700;font-size:18px">${fmt(order.total_amount)}</td>
      </tr>
    </table>

    <p style="margin-top:32px;color:#666;font-size:13px">
      ${s.orderNumberLabel}: <code>${escapeHtml(order.id)}</code><br/>
      ${s.senderLabel}: ${senderLine}<br/>
      ${s.footer}
    </p>
  </div>
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
       o.id, o.user_id, o.status, o.total_amount, o.currency, o.paid_at,
       u.email AS buyer_email, u.name AS buyer_name, u.phone AS buyer_phone,
       e.title AS event_title, e.date_start AS event_date_start,
       e.qr_policy AS event_qr_policy,
       e.vat_category AS event_vat_category,
       v.name AS venue_name,
       p.name AS promoter_name,
       COALESCE(p.contact_email, p.email) AS promoter_email,
       p.country AS promoter_country,
       p.brand_color_hex,
       p.brand_logo_url,
       p.vat_rate_pct AS promoter_vat_rate_pct
     FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     LEFT JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     WHERE o.id = $1`,
    [orderId],
  );
  if (orderRes.rows.length === 0) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  const order = orderRes.rows[0];
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

  // Spočítej efektivní DPH sazbu (per-event vat_category > promoter flat rate).
  // Použito i v renderTicketsPdf níže.
  const effectiveVatRatePct = order.event_vat_category
    ? resolveVatRate({
        country: order.promoter_country,
        vatCategory: order.event_vat_category,
      })
    : (order.promoter_vat_rate_pct ?? 10);

  // Issue tickets + render PDF attachment.
  // Failures here must NOT block the email (best-effort) — order is already paid.
  let ticketsIssued = 0;
  let pdfAttachment: { filename: string; content: Buffer } | undefined;
  let issued: Awaited<ReturnType<typeof issueTicketsForOrder>> = [];
  try {
    issued = await issueTicketsForOrder(orderId, db());
    ticketsIssued = issued.length;

    // Loyalty award (CZ priority #6) — fire-and-forget, idempotent na order_id.
    // Award points pouze pokud order má user_id (guest checkouts get bod-less).
    if (order.user_id && order.total_amount > 0) {
      const loyaltyClient = await db().connect();
      try {
        await loyaltyClient.query('BEGIN');
        await loyaltyClient.query(`SET LOCAL app.is_platform_admin = 'true'`);
        await awardPointsForOrder(loyaltyClient, {
          userId: order.user_id,
          orderId,
          orderTotalHalire: order.total_amount,
        });
        await loyaltyClient.query('COMMIT');
      } catch (err) {
        await loyaltyClient.query('ROLLBACK').catch(() => undefined);
        console.error('[order-completed] loyalty award failed', err);
      } finally {
        loyaltyClient.release();
      }
    }

    // Group invitation auto-complete (CZ priority #5) — pokud tento order byl
    // linkován na group_invitation, zkontroluj jestli už dosáhl target_seats
    // a status flipni na 'completed'.
    {
      const groupClient = await db().connect();
      try {
        await groupClient.query('BEGIN');
        await groupClient.query(`SET LOCAL app.is_platform_admin = 'true'`);
        await groupClient.query(
          `UPDATE orders.group_invitations gi
              SET status = 'completed'
            WHERE gi.id = (
                  SELECT group_invitation_id FROM orders.orders WHERE id = $1
                )
              AND gi.status = 'open'
              AND (
                  SELECT COUNT(*) FROM orders.orders
                   WHERE group_invitation_id = gi.id AND status = 'paid'
              ) >= gi.target_seats`,
          [orderId],
        );
        await groupClient.query('COMMIT');
      } catch (err) {
        await groupClient.query('ROLLBACK').catch(() => undefined);
        console.error('[order-completed] group_invitation completion failed', err);
      } finally {
        groupClient.release();
      }
    }

    // Skip PDF when this is a duplicate call (existing tickets have empty secrets)
    const hasFreshSecrets = issued.every((t) => t.totpSecretBase32.length > 0);
    // Fire-and-forget conversion tracking (Q.2) — Meta CAPI + GA4
    if (hasFreshSecrets) {
      void fireConversionTracking(orderId).catch((err) =>
        console.error('[order-completed] conversion tracking failed', err),
      );
    }

    // QR policy: rotating_only nepošle PDF s QR (skipuje generování úplně,
    // kupec dostane jen email s linkem na /cs/t/[token] pro mobile QR).
    const skipPdfDueToPolicy = order.event_qr_policy === 'rotating_only';

    if (issued.length > 0 && hasFreshSecrets && !skipPdfDueToPolicy) {
      // Načti unit_price + seat label per ticket (pro DPH rozpis + sedadla v PDF)
      const priceRes = await db().query<{
        ticket_id: string;
        unit_price: number;
        sector: string | null;
        row: string | null;
        seat_number: string | null;
      }>(
        // tickets.tickets nemá order_item_id sloupec — join přes
        // (order_id, ticket_type_id), což je v order_items unikátní.
        `SELECT t.id AS ticket_id, oi.unit_price,
                es.sector, es.row, es.seat_number
         FROM tickets.tickets t
         JOIN orders.order_items oi
           ON oi.order_id = t.order_id AND oi.ticket_type_id = t.ticket_type_id
         LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
         WHERE t.order_id = $1`,
        [orderId],
      );
      const priceByTicket = new Map(
        priceRes.rows.map((r) => [
          r.ticket_id,
          {
            price: r.unit_price,
            seat: r.sector
              ? `${r.sector} · řada ${r.row ?? '?'} · sedadlo ${r.seat_number ?? '?'}`
              : null,
          },
        ]),
      );

      const pdfBuf = await renderTicketsPdf(
        {
          eventTitle: order.event_title,
          eventDateStart: order.event_date_start,
          venueName: order.venue_name,
          buyerName: order.buyer_name ?? order.buyer_email,
          buyerEmail: order.buyer_email,
          orderId: order.id,
          promoterName: order.promoter_name,
          brandColorHex: order.brand_color_hex,
          brandLogoUrl: order.brand_logo_url,
          vatRatePct: effectiveVatRatePct,
        },
        issued.map((t) => {
          const meta = priceByTicket.get(t.ticketId);
          return {
            ticketId: t.ticketId,
            ticketTypeName: t.ticketTypeName,
            totpSecretBase32: t.totpSecretBase32,
            holderLabel: order.buyer_email,
            issuer: order.event_title,
            unitPriceHalire: meta?.price,
            seatLabel: meta?.seat ?? null,
          };
        }),
      );
      const filenameSlug = (order.promoter_name ?? 'tixly')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24);
      pdfAttachment = {
        filename: `${filenameSlug || 'tixly'}-${order.id.slice(0, 8)}.pdf`,
        content: pdfBuf,
      };
    }
  } catch (err) {
    console.error('[order-completed] ticket issue / PDF failed:', err);
  }

  // Loyalty: award points pro user_id (idempotent per order_id)
  try {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const { awardPointsForOrder } = await import('@/lib/loyalty/engine');
      await awardPointsForOrder(client, {
        userId: order.user_id,
        orderId: order.id,
        orderTotalHalire: order.total_amount,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[order-completed] loyalty award failed:', err);
  }

  // Odešli e-mail přes centrální mailer (Mailhog v dev, Resend/Postmark/SES v prod)
  let emailSent = false;
  try {
    const { sendMail } = await import('@/lib/email/mailer');
    // Sender: pokud má promotér vlastní doménu, použijeme ji jako display name
    // (technický from header zůstává EMAIL_FROM kvůli SPF/DKIM dokud nemá ověřenou doménu).
    const senderName = order.promoter_name ?? 'Tixly';
    const fromAddr = process.env.EMAIL_FROM ?? 'vstupenky@tixly.local';
    const subjectPrefix = order.promoter_name ?? 'Tixly';
    await sendMail({
      from: `"${senderName}" <${fromAddr}>`,
      to: order.buyer_email,
      subject: `${subjectPrefix} — vstupenky na ${order.event_title}`,
      html,
      attachments: pdfAttachment ? [pdfAttachment] : undefined,
    });
    emailSent = true;
  } catch (err) {
    console.error('[order-completed] email failed:', err);
  }

  // SMS vstupenky (SMSticket-style) — link na magic show page per ticket.
  // Pokud kupec má telefon, posíláme:
  //   - 1 ticket: SMS s URL na fullscreen QR
  //   - 2+ tickets: SMS s URL na první ticket + zmínka že email má všechny
  let smsSent = false;
  if (order.buyer_phone && issued.length > 0) {
    const firstIssued = issued[0];
    if (!firstIssued) {
      throw new Error('Unreachable: issued.length > 0 but issued[0] undefined');
    }
    const { issueTicketMagicToken } = await import('@/lib/tickets/magic-token');
    const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const firstToken = issueTicketMagicToken(firstIssued.ticketId);
    const url = `${appUrl}/cs/t/${firstToken}`;
    const eventShort = order.event_title.slice(0, 30);
    const smsText =
      issued.length === 1
        ? `Tixly ${eventShort}: vstupenka ${url}`
        : `Tixly ${eventShort}: ${issued.length} vstupenek (${formatCzk(order.total_amount)}). První: ${url}. Vše v emailu.`;
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
  const o = r.rows[0];
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
