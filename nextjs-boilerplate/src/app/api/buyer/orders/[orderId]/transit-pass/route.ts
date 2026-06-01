/**
 * GET /api/buyer/orders/[orderId]/transit-pass
 *
 * Idempotent — pokud transit_pass už existuje, vrátí ho. Jinak vygeneruje
 * přes DPP SDK (mock) a uloží do orders.transit_passes.
 *
 * Vrací: { qrPayload, zones, validFrom, validUntil, partnerName, isMock }
 *
 * Buyer musí být owner orderu.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { isMockMode, issueTransitPass } from '@/lib/transit/dpp';


export async function GET(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  // Verify ownership + load event date
  const orderRes = await db().query<{
    id: string;
    user_id: string;
    status: string;
    event_id: string;
    event_date_start: string;
  }>(
    `SELECT o.id, o.user_id, o.status, o.event_id, e.date_start::text AS event_date_start
     FROM orders.orders o
     JOIN catalog.events e ON e.id = o.event_id
     WHERE o.id = $1`,
    [params.orderId],
  );
  if (orderRes.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const order = orderRes.rows[0];
  if (order.user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (order.status !== 'paid' && order.status !== 'paid_partial') {
    return NextResponse.json(
      { error: 'NOT_PAID', message: 'Transit pass se vystaví až po zaplacení.' },
      { status: 409 },
    );
  }

  // Existing pass?
  const existing = await db().query<{
    qr_payload: string;
    zones: string[];
    valid_from: string;
    valid_until: string;
    is_mock: boolean;
    partner_name: string;
    partner_slug: string;
  }>(
    `SELECT tp.qr_payload, tp.zones, tp.valid_from::text, tp.valid_until::text,
            tp.is_mock,
            mp.name AS partner_name, mp.slug AS partner_slug
     FROM orders.transit_passes tp
     JOIN marketing.transit_partners mp ON mp.id = tp.partner_id
     WHERE tp.order_id = $1`,
    [params.orderId],
  );
  if (existing.rows.length > 0) {
    const p = existing.rows[0];
    return NextResponse.json({
      qrPayload: p.qr_payload,
      zones: p.zones,
      validFrom: p.valid_from,
      validUntil: p.valid_until,
      partnerName: p.partner_name,
      partnerSlug: p.partner_slug,
      isMock: p.is_mock,
      alreadyIssued: true,
    });
  }

  // Need to issue — najdi event combo config
  const comboRes = await db().query<{
    partner_id: string;
    partner_slug: string;
    partner_name: string;
    zones: string[];
    valid_from_offset_hours: number;
    valid_until_offset_hours: number;
    enabled: boolean;
  }>(
    `SELECT etc.partner_id, tp.slug AS partner_slug, tp.name AS partner_name,
            etc.zones, etc.valid_from_offset_hours, etc.valid_until_offset_hours,
            etc.enabled
     FROM catalog.event_transit_combo etc
     JOIN marketing.transit_partners tp ON tp.id = etc.partner_id
     WHERE etc.event_id = $1`,
    [order.event_id],
  );
  if (comboRes.rows.length === 0 || !comboRes.rows[0].enabled) {
    return NextResponse.json(
      { error: 'NO_TRANSIT_COMBO', message: 'Tato akce nemá MHD jízdenku.' },
      { status: 404 },
    );
  }
  const combo = comboRes.rows[0];

  const eventDate = new Date(order.event_date_start);
  const validFrom = new Date(eventDate.getTime() + combo.valid_from_offset_hours * 3600 * 1000);
  const validUntil = new Date(eventDate.getTime() + combo.valid_until_offset_hours * 3600 * 1000);

  let result;
  try {
    result = await issueTransitPass({
      orderId: order.id,
      partnerSlug: combo.partner_slug,
      zones: combo.zones,
      validFrom,
      validUntil,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err as { code?: string }).code === 'TRANSIT_PROVIDER_UNAVAILABLE'
    ) {
      return NextResponse.json(
        {
          error: 'TRANSIT_PROVIDER_UNAVAILABLE',
          message:
            'MHD jízdenka momentálně nedostupná. Zkuste později nebo kontaktujte pořadatele.',
          partnerSlug: combo.partner_slug,
        },
        { status: 503 },
      );
    }
    throw err;
  }

  await db().query(
    `INSERT INTO orders.transit_passes
       (order_id, partner_id, zones, valid_from, valid_until,
        validation_signature, qr_payload, is_mock)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
     ON CONFLICT (order_id) DO NOTHING`,
    [
      order.id,
      combo.partner_id,
      JSON.stringify(combo.zones),
      validFrom.toISOString(),
      validUntil.toISOString(),
      result.validationSignature,
      result.qrPayload,
      result.isMock,
    ],
  );

  return NextResponse.json({
    qrPayload: result.qrPayload,
    zones: combo.zones,
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    partnerName: combo.partner_name,
    partnerSlug: combo.partner_slug,
    isMock: result.isMock || isMockMode(),
    alreadyIssued: false,
  });

  });
}
