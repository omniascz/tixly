/**
 * POST /api/v1/publish/events
 *
 * Publish API — external ticketing system pushes an event into Tixly's
 * distribution network. Tixly creates a listing, sells tickets, and sends
 * a sold-notification webhook back to the source system.
 *
 * Auth: B2B Bearer token (tick_live_*) with scope `publish:write`.
 *
 * Body:
 * {
 *   externalId:    string     — your internal event ID (must be unique per key)
 *   title:         string
 *   description?:  string
 *   imageUrl?:     string
 *   venueId?:      uuid       — Tixly venue ID (optional; use venueName + address if unknown)
 *   venueName?:    string
 *   venueAddress?: string
 *   dateStart:     ISO8601    — event start (UTC)
 *   dateEnd?:      ISO8601
 *   callbackUrl?:  string     — webhook for sold notifications (overrides key default)
 *   tickets: [{
 *     externalId:  string
 *     name:        string
 *     price:       number     — in minor currency units (halíře/cents/grosz)
 *     currency:    string     — ISO 4217 (CZK / EUR / PLN / GBP)
 *     capacity:    number
 *   }]
 * }
 *
 * Response:
 * { ok: true, eventId, slug, eventUrl, ticketTypes: [{externalId, ticketTypeId}] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { b2bResponseHeaders, verifyB2bToken } from '@/lib/b2b-auth';
import { db, runWithPromoterContext } from '@/lib/db/rls-pool';
import { isValidCzDic } from '@/lib/tax/vat';
import { resolveTicketTypeVatCode } from '@/lib/tax/vat-readiness';

export const dynamic = 'force-dynamic';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

const TicketSchema = z.object({
  externalId: z.string().min(1).max(100),
  name:       z.string().min(1).max(120),
  price:      z.number().int().min(0),
  currency:   z.string().length(3).toUpperCase(),
  capacity:   z.number().int().min(1).max(1_000_000),
  // Kolo 7 (C-54): kód sazby DPH; povinný u placené vstupenky plátce.
  vatRateCode: z.string().max(40).nullable().optional(),
});

const PublishEventSchema = z.object({
  externalId:    z.string().min(1).max(100),
  title:         z.string().min(1).max(200),
  description:   z.string().max(10_000).optional(),
  imageUrl:      z.string().url().optional(),
  venueId:       z.string().uuid().optional(),
  venueName:     z.string().max(200).optional(),
  venueAddress:  z.string().max(500).optional(),
  dateStart:     z.string().datetime(),
  dateEnd:       z.string().datetime().optional(),
  callbackUrl:   z.string().url().optional(),
  tickets:       z.array(TicketSchema).min(1).max(50),
});

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: b2bResponseHeaders() });
}

export async function POST(req: NextRequest): Promise<Response> {
  const ctx = await verifyB2bToken(req);
  if (!ctx) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED' },
      { status: 401, headers: b2bResponseHeaders() },
    );
  }
  if (!ctx.scope.includes('publish:write') && !ctx.scope.includes('*')) {
    return NextResponse.json(
      { error: 'INSUFFICIENT_SCOPE', required: 'publish:write' },
      { status: 403, headers: b2bResponseHeaders(ctx) },
    );
  }

  let body: z.infer<typeof PublishEventSchema>;
  try {
    body = PublishEventSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: err }, { status: 400, headers: b2bResponseHeaders(ctx) });
  }

  return runWithPromoterContext(ctx.promoterId, async () => {
    // Check duplicate external ID
    const dup = await db().query<{ id: string }>(
      `SELECT id FROM catalog.events WHERE source_system = 'external' AND source_event_id = $1`,
      [`${ctx.keyId}:${body.externalId}`],
    );
    if (dup.rows.length > 0) {
      return NextResponse.json(
        { error: 'ALREADY_EXISTS', eventId: dup.rows[0].id },
        { status: 409, headers: b2bResponseHeaders(ctx) },
      );
    }

    // Kolo 7 (C-54): akce vzniká rovnou publikovaná → DPH musí být připravené PŘED prvním zápisem.
    {
      const pr = await db().query<{ vat_payer: boolean; company_dic: string | null }>(
        `SELECT vat_payer, company_dic FROM platform.promoters WHERE id = $1`,
        [ctx.promoterId],
      );
      const prom = pr.rows[0];
      if (prom?.vat_payer && !isValidCzDic(prom.company_dic)) {
        return NextResponse.json(
          { error: 'VAT_NOT_CONFIGURED', message: 'Akci nelze publikovat: pořadatel je plátce DPH, ale v profilu nemá platné DIČ.' },
          { status: 422, headers: b2bResponseHeaders(ctx) },
        );
      }
      for (const tt of body.tickets) {
        const v = await resolveTicketTypeVatCode(db(), ctx.promoterId, tt.price, tt.vatRateCode);
        if ('error' in v) {
          return NextResponse.json(
            { error: 'VAT_NOT_CONFIGURED', message: `Akci nelze publikovat: ${tt.name} — ${v.error}` },
            { status: 422, headers: b2bResponseHeaders(ctx) },
          );
        }
      }
    }

    const slug = `${slugify(body.title)}-${Date.now().toString(36)}`;

    // Resolve venue
    let venueId = body.venueId ?? null;
    if (!venueId && body.venueName) {
      const vRes = await db().query<{ id: string }>(
        `INSERT INTO catalog.venues (promoter_id, name, address, capacity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (promoter_id, name) DO UPDATE SET address = EXCLUDED.address
         RETURNING id`,
        [
          ctx.promoterId,
          body.venueName,
          body.venueAddress ?? body.venueName,
          body.tickets.reduce((sum, t) => sum + t.capacity, 0),
        ],
      );
      venueId = vRes.rows[0].id;
    }

    // Create production
    const prodRes = await db().query<{ id: string }>(
      `INSERT INTO catalog.productions (promoter_id, title, description, poster_url, status)
       VALUES ($1, $2, $3, $4, 'published')
       RETURNING id`,
      [ctx.promoterId, body.title, body.description ?? null, body.imageUrl ?? null],
    );
    const productionId = prodRes.rows[0].id;

    // Create event
    const eventRes = await db().query<{ id: string }>(
      `INSERT INTO catalog.events
         (promoter_id, production_id, venue_id, date_start, date_end, slug, status,
          source_system, source_event_id, source_callback_url)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', 'external', $7, $8)
       RETURNING id`,
      [
        ctx.promoterId,
        productionId,
        venueId,
        body.dateStart,
        body.dateEnd ?? null,
        slug,
        `${ctx.keyId}:${body.externalId}`,
        body.callbackUrl ?? null,
      ],
    );
    const eventId = eventRes.rows[0].id;

    // Create ticket types
    const ticketTypes: Array<{ externalId: string; ticketTypeId: string }> = [];
    for (const tt of body.tickets) {
      const ttRes = await db().query<{ id: string }>(
        `INSERT INTO catalog.ticket_types
           (event_id, name, base_price, total_qty, remaining_qty, kind, vat_rate_code)
         VALUES ($1, $2, $3, $4, $4, 'standing', $5)
         RETURNING id`,
        [eventId, tt.name, tt.price, tt.capacity, (await resolveTicketTypeVatCode(db(), ctx.promoterId, tt.price, tt.vatRateCode) as { code: string | null }).code],
      );
      ticketTypes.push({ externalId: tt.externalId, ticketTypeId: ttRes.rows[0].id });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    return NextResponse.json(
      {
        ok: true,
        eventId,
        slug,
        eventUrl: `${appUrl}/events/${slug}`,
        ticketTypes,
      },
      { status: 201, headers: b2bResponseHeaders(ctx) },
    );
  });
}

/** GET /api/v1/publish/events — list published events from this key */
export async function GET(req: NextRequest): Promise<Response> {
  const ctx = await verifyB2bToken(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: b2bResponseHeaders() });
  }
  if (!ctx.scope.includes('publish:read') && !ctx.scope.includes('publish:write') && !ctx.scope.includes('*')) {
    return NextResponse.json({ error: 'INSUFFICIENT_SCOPE', required: 'publish:read' }, { status: 403, headers: b2bResponseHeaders(ctx) });
  }

  return runWithPromoterContext(ctx.promoterId, async () => {
    const res = await db().query<{
      id: string;
      source_event_id: string;
      slug: string;
      title: string;
      date_start: string;
      status: string;
    }>(
      `SELECT e.id, e.source_event_id, e.slug,
              pr.title, e.date_start, e.status
       FROM catalog.events e
       JOIN catalog.productions pr ON pr.id = e.production_id
       WHERE e.source_system = 'external'
         AND e.source_event_id LIKE $1
       ORDER BY e.date_start
       LIMIT 100`,
      [`${ctx.keyId}:%`],
    );

    return NextResponse.json(
      {
        events: res.rows.map((r) => ({
          eventId: r.id,
          externalId: r.source_event_id.replace(`${ctx.keyId}:`, ''),
          title: r.title,
          slug: r.slug,
          dateStart: r.date_start,
          status: r.status,
        })),
      },
      { headers: b2bResponseHeaders(ctx) },
    );
  });
}
