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
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import type { Pool } from 'pg';

import { escapeHtml } from '@/lib/html-escape/escape';
import { sendSms } from '@/lib/sms/bulkgate-mock';
import { resolveVatRate, splitGrossToNetVat } from '@/lib/tax/vat-rates';
import { awardPointsForOrder } from '@/lib/loyalty/engine';
import { issueFanBonus } from '@/lib/fan-bonus/engine';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';
import { renderTicketsPdf } from '@/lib/tickets/pdf-renderer';
import { buildPkpass, type PassData } from '@/lib/wallet/apple-pass';


function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface OrderRow {
  id: string;
  event_id: string | null;
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
  buyer_vat_number: string | null;
  buyer_company_name: string | null;
  is_reverse_charge: boolean;
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

interface TravelBookingEmailRow {
  hotel_name: string;
  hotel_address: string | null;
  hotel_stars: number | null;
  room_name: string;
  checkin_date: string;
  checkout_date: string;
  nights: number;
  guests: number;
  price_per_night_halire: number;
  total_price_halire: number;
  confirmation_code: string | null;
}

function buildEmailHtml(order: OrderRow, items: ItemRow[], accessibleGateLines: string[] = [], travelBookings: TravelBookingEmailRow[] = []): string {
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
  // B2B reverse charge → 0 % (EU cross-border, mig 390).
  const effectiveVatRateEmail = order.is_reverse_charge
    ? 0
    : order.event_vat_category
      ? resolveVatRate({ country: order.promoter_country, vatCategory: order.event_vat_category })
      : (order.promoter_vat_rate_pct ?? 10);
  const vatRatePct = effectiveVatRateEmail;
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
    ${accessibleGateLines.length > 0 ? `
    <div style="margin:12px 0;padding:10px 14px;background:#ecfdf5;border-left:3px solid #059669;border-radius:4px">
      <strong style="color:#047857">♿ Bezbariérový vstup</strong><br/>
      ${accessibleGateLines.map((l) => `<span style="color:#065f46;font-size:14px">${escapeHtml(l)}</span>`).join('<br/>')}
    </div>` : ''}

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

    ${travelBookings.length > 0 ? travelBookings.map((tb) => `
    <div style="margin-top:28px;border:2px solid #f59e0b;border-radius:8px;overflow:hidden">
      <div style="background:#f59e0b;padding:12px 16px;color:#fff">
        <strong style="font-size:16px">🏨 Ubytování — EVENTIM.Travel</strong>
      </div>
      <div style="padding:16px;background:#fffbeb">
        <p style="margin:0 0 8px;font-size:17px;font-weight:600">${escapeHtml(tb.hotel_name)}${tb.hotel_stars ? ` ${'★'.repeat(tb.hotel_stars)}` : ''}</p>
        ${tb.hotel_address ? `<p style="margin:0 0 4px;color:#666;font-size:13px">📍 ${escapeHtml(tb.hotel_address)}</p>` : ''}
        <p style="margin:4px 0;font-size:14px">🛏 ${escapeHtml(tb.room_name)} · ${tb.guests > 1 ? `${tb.guests} hosté` : '1 host'}</p>
        <p style="margin:4px 0;font-size:14px">📅 Check-in: <strong>${escapeHtml(tb.checkin_date)}</strong> → Check-out: <strong>${escapeHtml(tb.checkout_date)}</strong> (${tb.nights} nocí)</p>
        <p style="margin:8px 0 0;font-size:15px;font-weight:600">Cena ubytování: ${fmt(tb.total_price_halire)}</p>
        ${tb.confirmation_code ? `<p style="margin:8px 0 0;padding:8px;background:#fef3c7;border-radius:4px;font-size:13px">Kód rezervace: <code style="font-size:15px;font-weight:bold">${escapeHtml(tb.confirmation_code)}</code></p>` : ''}
      </div>
    </div>`).join('') : ''}

    <p style="margin-top:32px;color:#666;font-size:13px">
      ${s.orderNumberLabel}: <code>${escapeHtml(order.id)}</code><br/>
      ${s.senderLabel}: ${senderLine}<br/>
      ${s.footer}
    </p>
  </div>
</body></html>`;
}

export async function POST(request: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = request.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Kontrakt C2 (FINDINGS §134) ───────────────────────────────────────────
  // Post-processing po zaplaceni. Kroky se deli na KRITICKE (bez nich je
  // objednavka nekompletni: vydani listku, modularni pristupy, group/party
  // sloty) a VOLITELNE (e-mail, SMS, wallet pass, analytika, royalty, forgemsg).
  // Do `failed` jde jen selhani kritickeho kroku; volitelne jde do `degraded`.
  // Padat se nesmi — platba uz probehla a 500 by webhook nutil retryovat.
  let failed = 0;
  const errors: string[] = [];
  const degraded: string[] = [];
  const critical = (step: string, err: unknown) => {
    failed++;
    errors.push(`${step}: ${String((err as Error)?.message).slice(0, 140)}`);
  };
  const optional = (step: string, err: unknown) => {
    degraded.push(`${step}: ${String((err as Error)?.message).slice(0, 100)}`);
  };

  const body = (await request.json().catch(() => null)) as { orderId?: string } | null;
  const orderId = body?.orderId;
  if (!orderId) {
    return NextResponse.json({ error: 'orderId required' }, { status: 422 });
  }

  // Načti objednávku + položky + akci + místo
  const orderRes = await db().query<OrderRow>(
    `SELECT
       o.id, o.event_id, o.user_id, o.status, o.total_amount, o.currency, o.paid_at,
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
       p.vat_rate_pct AS promoter_vat_rate_pct,
       o.buyer_vat_number,
       o.buyer_company_name,
       o.is_reverse_charge
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

  // Bezbariérové vstupy pro tuto akci (mig 381)
  // Vrátí seznam bran + poznámek pro zóny označené accessible_gate_id.
  let accessibleGateLines: string[] = [];
  if (order.event_id) {
    const gateRes = await db().query<{ gate_code: string; gate_label: string; notes: string | null }>(
      `SELECT vg.code AS gate_code, vg.label AS gate_label, ez.accessible_gate_notes AS notes
         FROM catalog.event_zones ez
         JOIN catalog.venue_gates vg ON vg.id = ez.accessible_gate_id
        WHERE ez.event_id = $1 AND ez.accessible_gate_id IS NOT NULL
        ORDER BY vg.sort_order, vg.code`,
      [order.event_id],
    ).catch(() => ({ rows: [] as { gate_code: string; gate_label: string; notes: string | null }[] }));
    accessibleGateLines = gateRes.rows.map(
      (g) => `${g.gate_label}${g.notes ? ` — ${g.notes}` : ''}`,
    );
  }

  // Confirm pending addons → confirmed
  await db().query(
    `UPDATE public.order_addons SET status = 'confirmed'
     WHERE order_id = $1 AND status = 'pending'`,
    [orderId],
  );

  // EVENTIM.Travel — confirm pending travel bookings + load for email
  await db().query(
    `UPDATE orders.travel_bookings SET status = 'confirmed' WHERE order_id = $1 AND status = 'pending'`,
    [orderId],
  );
  const travelRes = await db().query<{
    hotel_name: string;
    hotel_address: string | null;
    hotel_stars: number | null;
    room_name: string;
    checkin_date: string;
    checkout_date: string;
    nights: number;
    guests: number;
    price_per_night_halire: number;
    total_price_halire: number;
    confirmation_code: string | null;
  }>(
    `SELECT hotel_name, hotel_address, hotel_stars, room_name,
            checkin_date, checkout_date, nights, guests,
            price_per_night_halire, total_price_halire, confirmation_code
       FROM orders.travel_bookings WHERE order_id = $1 AND status = 'confirmed'`,
    [orderId],
  );
  const travelBookings = travelRes.rows;

  const html = buildEmailHtml(order, itemsRes.rows, accessibleGateLines, travelBookings);

  // Spočítej efektivní DPH sazbu (per-event vat_category > promoter flat rate).
  // B2B reverse charge → 0 % (EU cross-border, mig 390).
  const effectiveVatRatePct = order.is_reverse_charge
    ? 0
    : order.event_vat_category
      ? resolveVatRate({ country: order.promoter_country, vatCategory: order.event_vat_category })
      : (order.promoter_vat_rate_pct ?? 10);

  // Issue tickets + render PDF + Apple Wallet passes.
  // Failures here must NOT block the email (best-effort) — order is already paid.
  let ticketsIssued = 0;
  let pdfAttachment: { filename: string; content: Buffer } | undefined;
  let walletAttachments: { filename: string; content: Buffer; contentType: string }[] = [];
  let issued: Awaited<ReturnType<typeof issueTicketsForOrder>> = [];
  try {
    issued = await issueTicketsForOrder(orderId, db() as unknown as Pool);
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

    // FanBonus — 2-3 % cashback jako platform-wide gift voucher, fire-and-forget.
    if (order.total_amount > 0 && order.event_id) {
      const fbClient = await db().connect();
      try {
        await fbClient.query('BEGIN');
        await fbClient.query(`SET LOCAL app.is_platform_admin = 'true'`);
        await issueFanBonus(fbClient, {
          orderId,
          eventId: order.event_id as string,
          userId:  order.user_id ?? null,
          buyerEmail: order.buyer_email,
          orderTotalHalire: order.total_amount,
        });
        await fbClient.query('COMMIT');
      } catch (err) {
        await fbClient.query('ROLLBACK').catch(() => undefined);
        console.error('[order-completed] fan-bonus issue failed', err);
      } finally {
        fbClient.release();
      }
    }

    // Modular pass pickup — pokud order byl checkout přes
    // /api/buyer/modular-pass/checkout, máme uložené buyer-selected (day×zone)
    // tuples v marketing.modular_pass_pending_selections. Insertneme je do
    // tickets.ticket_modular_access pro každý issued ticket (typicky 1 ticket
    // per modular order — buyer si kupuje 1 modular pass).
    {
      const modClient = await db().connect();
      try {
        await modClient.query('BEGIN');
        await modClient.query(`SET LOCAL app.is_platform_admin = 'true'`);
        const pending = await modClient.query<{ selections: Array<{ dayId: string; zoneId: string }> }>(
          `SELECT selections FROM marketing.modular_pass_pending_selections
            WHERE order_id = $1`,
          [orderId],
        );
        if (pending.rows.length > 0 && issued.length > 0) {
          const selections = pending.rows[0].selections;
          for (const t of issued) {
            for (const sel of selections) {
              await modClient.query(
                `INSERT INTO tickets.ticket_modular_access
                   (ticket_id, event_day_id, zone_id, access_level)
                 VALUES ($1, $2, $3, 'general')
                 ON CONFLICT (ticket_id, event_day_id, zone_id) DO NOTHING`,
                [t.ticketId, sel.dayId, sel.zoneId],
              );
            }
          }
          // Cleanup pending row
          await modClient.query(
            `DELETE FROM marketing.modular_pass_pending_selections WHERE order_id = $1`,
            [orderId],
          );
        }
        await modClient.query('COMMIT');
      } catch (err) {
        await modClient.query('ROLLBACK').catch(() => undefined);
        critical('modular_pass', err); console.error('[order-completed] modular pass pickup failed', err);
      } finally {
        modClient.release();
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
        critical('group_invitations', err); console.error('[order-completed] group_invitation completion failed', err);
      } finally {
        groupClient.release();
      }
    }

    // Party Pay — mark slot paid + check if session is now complete
    {
      const partyClient = await db().connect();
      try {
        await partyClient.query('BEGIN');
        await partyClient.query(`SET LOCAL app.is_platform_admin = 'true'`);

        const slotUpd = await partyClient.query<{ session_id: string }>(
          `UPDATE orders.party_split_slots
           SET status = 'paid', paid_at = NOW()
           WHERE order_id = $1 AND status IN ('reserved', 'pending')
           RETURNING session_id`,
          [orderId],
        );

        if (slotUpd.rows.length > 0) {
          const sessionId = slotUpd.rows[0].session_id;
          // Complete session if all slots are paid
          await partyClient.query(
            `UPDATE orders.party_split_sessions
             SET status = 'complete', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1
               AND NOT EXISTS (
                 SELECT 1 FROM orders.party_split_slots
                 WHERE session_id = $1 AND status != 'paid'
               )`,
            [sessionId],
          );
        }

        await partyClient.query('COMMIT');
      } catch (err) {
        await partyClient.query('ROLLBACK').catch(() => undefined);
        critical('party_split', err); console.error('[order-completed] party_split slot completion failed', err);
      } finally {
        partyClient.release();
      }
    }

    // Skip PDF when this is a duplicate call (existing tickets have empty secrets)
    const hasFreshSecrets = issued.every((t) => t.totpSecretBase32.length > 0);
    // Fire-and-forget conversion tracking (Q.2) — Meta CAPI + GA4
    if (hasFreshSecrets) {
      void fireConversionTracking(orderId).catch((err) =>
        console.error('[order-completed] conversion tracking failed', err),
      );
      // Accrue artist royalties asynchronně
      void fetch(
        `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/internal/royalties/accrue`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': process.env.INTERNAL_API_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? '',
          },
          body: JSON.stringify({ orderId }),
        },
      ).catch((err) => console.error('[order-completed] royalty accrue failed', err));

      // Complete resale ticket transfer if this is a resale order
      void fetch(
        `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/internal/resale/complete-transfer`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': process.env.INTERNAL_API_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? '',
          },
          body: JSON.stringify({ orderId }),
        },
      ).catch((err) => console.error('[order-completed] resale transfer failed', err));
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
        accessibility: boolean | null;
      }>(
        // tickets.tickets nemá order_item_id sloupec — join přes
        // (order_id, ticket_type_id), což je v order_items unikátní.
        `SELECT t.id AS ticket_id, oi.unit_price,
                es.sector, es.row, es.seat_number, es.accessibility
         FROM tickets.tickets t
         JOIN orders.order_items oi
           ON oi.order_id = t.order_id AND oi.ticket_type_id = t.ticket_type_id
         LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
         WHERE t.order_id = $1`,
        [orderId],
      );
      const accessibleGateStr = accessibleGateLines.length > 0 ? accessibleGateLines.join('; ') : null;
      const priceByTicket = new Map(
        priceRes.rows.map((r) => [
          r.ticket_id,
          {
            price: r.unit_price,
            seat: r.sector
              ? `${r.sector} · řada ${r.row ?? '?'} · sedadlo ${r.seat_number ?? '?'}`
              : null,
            accessibleGateInfo: r.accessibility ? accessibleGateStr : null,
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
            accessibleGateInfo: meta?.accessibleGateInfo ?? null,
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

      // Apple Wallet passes — max 8 per email, best-effort.
      // iOS Mail rozpozná .pkpass přílohu a nabídne "Přidat do Peněženky".
      for (const t of issued.slice(0, 8)) {
        try {
          const passData: PassData = {
            ticketId: t.ticketId,
            eventTitle: order.event_title,
            eventDateIso: order.event_date_start,
            ticketTypeName: t.ticketTypeName,
            holderName: order.buyer_name,
            holderEmail: order.buyer_email,
            venueName: order.venue_name,
            qrPayload: `tixly://ticket/${t.ticketId}`,
            organizationName: order.promoter_name ?? 'Tixly',
            brandColorHex: order.brand_color_hex,
            brandLogoUrl: order.brand_logo_url,
            seatLabel: priceByTicket.get(t.ticketId)?.seat ?? null,
          };
          const { buffer: pkpassBuf } = buildPkpass(passData);
          walletAttachments.push({
            filename: `vstupenka-${t.ticketId.slice(0, 8)}.pkpass`,
            content: pkpassBuf,
            contentType: 'application/vnd.apple.pkpass',
          });
        } catch (passErr) {
          console.warn('[order-completed] wallet pass failed for ticket', t.ticketId, passErr);
        }
      }
    }
  } catch (err) {
    critical('ticket_issue', err); console.error('[order-completed] ticket issue / PDF failed:', err);
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
    optional('loyalty', err); console.error('[order-completed] loyalty award failed:', err);
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
    const emailAttachments: { filename: string; content: Buffer; contentType?: string }[] = [
      ...(pdfAttachment ? [pdfAttachment] : []),
      ...walletAttachments,
    ];
    await sendMail({
      from: `"${senderName}" <${fromAddr}>`,
      to: order.buyer_email,
      subject: `${subjectPrefix} — vstupenky na ${order.event_title}`,
      html,
      attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
    });
    emailSent = true;
  } catch (err) {
    optional('email', err); console.error('[order-completed] email failed:', err);
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
      db() as unknown as Pool,
    );
    smsSent = r.ok;
    if (!r.ok) {
      console.warn('[order-completed] SMS failed:', r.reason);
    }
  }

  // ForgeMsg — emit order_paid into the outbox (best-effort; never blocks tickets).
  try {
    const { emitForgeMsg, splitName } = await import('@/lib/forgemsg/emit');
    const fm = await db().query<{
      event_id: string;
      promoter_id: string | null;
      category: string | null;
      subcategory: string | null;
      venue_city: string | null;
    }>(
      `SELECT e.id AS event_id, e.promoter_id, e.category, e.subcategory, v.city AS venue_city
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE o.id = $1`,
      [orderId],
    );
    const f = fm.rows[0];
    if (f) {
      await emitForgeMsg(
        {
          type: 'order_paid',
          contact: {
            email: order.buyer_email,
            phone: order.buyer_phone ?? undefined,
            ...splitName(order.buyer_name),
            city: f.venue_city ?? undefined,
          },
          event: {
            externalId: f.event_id,
            title: order.event_title,
            category: f.category ?? undefined,
            subcategory: f.subcategory ?? undefined,
            venueName: order.venue_name ?? undefined,
            venueCity: f.venue_city ?? undefined,
            startsAt: order.event_date_start ?? undefined,
            currency: order.currency,
          },
          order: {
            orderId: order.id,
            amount: order.total_amount, // haléře (minor units) — ForgeMsg divides by 100
            currency: order.currency,
            seats: issued.length,
          },
          occurredAt: order.paid_at ?? undefined,
        },
        f.promoter_id,
      );
    }
  } catch (err) {
    optional('forgemsg', err); console.error('[order-completed] forgemsg emit failed:', err);
  }

  return NextResponse.json({
    ok: failed === 0,
    processed: ticketsIssued,
    failed,
    errors: errors.slice(0, 20),
    degraded: degraded.slice(0, 20),
    success: failed === 0,
    orderId,
    emailSent,
    smsSent,
    items: itemsRes.rows.length,
    ticketsIssued,
    pdfAttached: pdfAttachment !== undefined,
  });

  });
}

async function fireConversionTracking(orderId: string): Promise<void> {
  const r = await db().query<{
    event_id: string;
    total_amount: number;
    currency: string;
    buyer_email: string;
    event_title: string;
    items: { ticket_type_id: string; name: string; quantity: number; unit_price: number }[];
  }>(
    `SELECT o.event_id, o.total_amount, o.currency,
            u.email AS buyer_email,
            e.title AS event_title,
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

  // Tracking creds jsou per-promotér (jeden pixel pro celé divadlo), CAPI token
  // a GA4 secret dešifrované z platform.promoters.*_enc.
  const { getPromoterTrackingByEvent } = await import('@/lib/tracking/promoter-creds');
  const creds = await getPromoterTrackingByEvent(o.event_id);

  if (creds.metaPixelId && creds.metaCapiToken) {
    const { sendMetaEvent } = await import('@/lib/tracking/meta-capi');
    await sendMetaEvent(
      {
        eventName: 'Purchase',
        eventTime: Math.floor(Date.now() / 1000),
        eventId: orderId,
        pixelId: creds.metaPixelId,
        capiToken: creds.metaCapiToken,
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

  if (creds.ga4MeasurementId && creds.ga4ApiSecret) {
    const { sendGA4Event } = await import('@/lib/tracking/ga4');
    await sendGA4Event(
      {
        measurementId: creds.ga4MeasurementId,
        apiSecret: creds.ga4ApiSecret,
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

  if (creds.tiktokPixelId && creds.tiktokEventsToken) {
    const { sendTikTokEvent } = await import('@/lib/tracking/tiktok-capi');
    await sendTikTokEvent({
      eventName: 'Purchase',
      pixelId: creds.tiktokPixelId,
      accessToken: creds.tiktokEventsToken,
      eventId: orderId,
      email: o.buyer_email,
      value: valueMajor,
      currency: o.currency,
      contentId: items[0]?.ticket_type_id,
      contentName: o.event_title,
      quantity: items.reduce((s, i) => s + i.quantity, 0),
      pageUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/cs/events/${o.event_id}`,
      catalogEventId: o.event_id,
      catalogOrderId: orderId,
    });
  }
}
