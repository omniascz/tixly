/**
 * GET /api/distribution/catalog
 *
 * Veřejný partner discovery endpoint — pro registrované distributory (resellery).
 * Auth: X-Partner-Key: <api_key from platform.reseller_partners>
 *
 * Vrátí seznam akcí s distribution_enabled=true včetně ticket type info.
 * Distributor může takto zobrazit a prodávat Tixly akce na svém webu/pokladně.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function GET(req: NextRequest): Promise<Response> {
  const partnerKey = req.headers.get('x-partner-key') ?? req.nextUrl.searchParams.get('key');
  if (!partnerKey) {
    return NextResponse.json({ error: 'X-Partner-Key header required' }, { status: 401 });
  }

  return runWithServiceContext(async () => {
    // Ověřit partner key
    const partner = await db().query<{
      id: string;
      name: string;
      commission_pct: number;
    }>(
      `SELECT id, name, commission_pct FROM platform.reseller_partners
       WHERE api_key = $1 AND status = 'active' LIMIT 1`,
      [partnerKey],
    );
    if (partner.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid or inactive partner key' }, { status: 403 });
    }
    const p = partner.rows[0];

    // Akce dostupné pro tohoto partnera
    const events = await db().query<{
      id: string;
      title: string;
      description: string | null;
      date_start: string;
      venue_name: string | null;
      venue_city: string | null;
      currency: string;
      cover_image_url: string | null;
      allocation_qty: number | null;
      commission_override_pct: number | null;
    }>(
      `SELECT
         e.id,
         e.title,
         e.description,
         e.date_start::text,
         v.name AS venue_name,
         v.city AS venue_city,
         e.currency,
         e.cover_image_url,
         edp.allocation_qty,
         edp.commission_override_pct
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN catalog.event_distribution_partners edp
         ON edp.event_id = e.id AND edp.partner_id = $1 AND edp.active = true
       WHERE e.distribution_enabled = true
         AND e.status = 'published'
         AND e.date_start > NOW()
         AND (
           edp.id IS NOT NULL
           OR NOT EXISTS (
             SELECT 1 FROM catalog.event_distribution_partners edp2
             WHERE edp2.event_id = e.id
           )
         )
       ORDER BY e.date_start
       LIMIT 200`,
      [p.id],
    );

    const eventIds = events.rows.map((e) => e.id);
    const tts =
      eventIds.length > 0
        ? await db().query<{
            event_id: string;
            id: string;
            name: string;
            base_price: number;
            remaining_qty: number;
          }>(
            `SELECT event_id, id, name, base_price, remaining_qty
             FROM catalog.ticket_types
             WHERE event_id = ANY($1) AND remaining_qty > 0
             ORDER BY base_price`,
            [eventIds],
          )
        : { rows: [] as { event_id: string; id: string; name: string; base_price: number; remaining_qty: number }[] };

    const ttsByEvent = new Map<string, typeof tts.rows>();
    for (const tt of tts.rows) {
      if (!ttsByEvent.has(tt.event_id)) ttsByEvent.set(tt.event_id, []);
      ttsByEvent.get(tt.event_id)!.push(tt);
    }

    return NextResponse.json(
      {
        partner: { id: p.id, name: p.name },
        generatedAt: new Date().toISOString(),
        events: events.rows.map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          dateStart: e.date_start,
          venue: e.venue_name ? { name: e.venue_name, city: e.venue_city } : null,
          currency: e.currency,
          coverImageUrl: e.cover_image_url,
          commissionPct: e.commission_override_pct ?? p.commission_pct,
          allocationQty: e.allocation_qty,
          checkoutUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/cs/events/${e.id}`,
          ticketTypes: (ttsByEvent.get(e.id) ?? []).map((tt) => ({
            id: tt.id,
            name: tt.name,
            basePrice: tt.base_price,
            remainingQty: tt.remaining_qty,
          })),
        })),
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  });
}
