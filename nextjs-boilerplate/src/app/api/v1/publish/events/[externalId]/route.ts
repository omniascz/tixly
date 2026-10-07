/**
 * PUT    /api/v1/publish/events/{externalId} — update published event
 * DELETE /api/v1/publish/events/{externalId} — cancel (mark cancelled)
 *
 * Auth: B2B Bearer token with publish:write scope.
 *
 * PUT body (all fields optional):
 * {
 *   title?:       string
 *   description?: string
 *   dateStart?:   ISO8601
 *   dateEnd?:     ISO8601
 *   status?:      'published' | 'cancelled' | 'postponed'
 *   callbackUrl?: string
 *   tickets?: [{
 *     externalId:     string   — must match original ticket externalId
 *     availableCount?: number  — override remaining capacity
 *     price?:          number  — price update
 *     status?:         'on_sale' | 'sold_out' | 'cancelled'
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithPromoterContext } from '@/lib/db/rls-pool';
import { b2bResponseHeaders, verifyB2bToken } from '@/lib/b2b-auth';

export const dynamic = 'force-dynamic';

const TicketUpdateSchema = z.object({
  externalId:      z.string(),
  availableCount:  z.number().int().min(0).optional(),
  price:           z.number().int().min(0).optional(),
  status:          z.enum(['on_sale', 'sold_out', 'cancelled']).optional(),
}).array().optional();

const UpdateSchema = z.object({
  title:        z.string().min(1).max(200).optional(),
  description:  z.string().max(10_000).optional(),
  dateStart:    z.string().datetime().optional(),
  dateEnd:      z.string().datetime().optional(),
  status:       z.enum(['published', 'cancelled', 'postponed']).optional(),
  callbackUrl:  z.string().url().optional(),
  tickets:      TicketUpdateSchema,
});

async function resolveEvent(ctx: { keyId: string; promoterId: string }, externalId: string) {
  return db().query<{ id: string }>(
    `SELECT id FROM catalog.events
     WHERE source_system = 'external' AND source_event_id = $1 AND promoter_id = $2`,
    [`${ctx.keyId}:${externalId}`, ctx.promoterId],
  );
}

export async function PUT(req: NextRequest, props: { params: Promise<{ externalId: string }> }): Promise<Response> {
  const params = await props.params;
  const ctx = await verifyB2bToken(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: b2bResponseHeaders() });
  }
  if (!ctx.scope.includes('publish:write') && !ctx.scope.includes('*')) {
    return NextResponse.json({ error: 'INSUFFICIENT_SCOPE' }, { status: 403, headers: b2bResponseHeaders(ctx) });
  }

  let body: z.infer<typeof UpdateSchema>;
  try {
    body = UpdateSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: err }, { status: 400, headers: b2bResponseHeaders(ctx) });
  }

  return runWithPromoterContext(ctx.promoterId, async () => {
    const evRes = await resolveEvent(ctx, params.externalId);
    if (evRes.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: b2bResponseHeaders(ctx) });
    }
    const eventId = evRes.rows[0].id;

    // Update event fields
    const eventUpdates: string[] = [];
    const eventValues: unknown[] = [eventId];

    if (body.dateStart) { eventUpdates.push(`date_start = $${eventValues.push(body.dateStart)}`); }
    if (body.dateEnd !== undefined) { eventUpdates.push(`date_end = $${eventValues.push(body.dateEnd)}`); }
    if (body.status) { eventUpdates.push(`status = $${eventValues.push(body.status)}`); }
    if (body.callbackUrl) { eventUpdates.push(`source_callback_url = $${eventValues.push(body.callbackUrl)}`); }

    if (eventUpdates.length > 0) {
      eventUpdates.push('updated_at = NOW()');
      await db().query(
        `UPDATE catalog.events SET ${eventUpdates.join(', ')} WHERE id = $1`,
        eventValues,
      );
    }

    // Update production fields (title, description)
    if (body.title || body.description !== undefined) {
      const prodUpdates: string[] = [];
      const prodValues: unknown[] = [eventId];
      if (body.title) { prodUpdates.push(`title = $${prodValues.push(body.title)}`); }
      if (body.description !== undefined) { prodUpdates.push(`description = $${prodValues.push(body.description)}`); }
      if (prodUpdates.length > 0) {
        await db().query(
          `UPDATE catalog.productions SET ${prodUpdates.join(', ')}
           WHERE id = (SELECT production_id FROM catalog.events WHERE id = $1)`,
          prodValues,
        );
      }
    }

    // Update ticket types
    if (body.tickets && body.tickets.length > 0) {
      for (const tt of body.tickets) {
        // We stored externalId per-ticket in the name during creation — not enough for lookup.
        // Better pattern: match by ticket name lookup in the event.
        // For now, we stored the externalId relationship implicitly via creation order.
        // TODO: add external_ticket_id column to ticket_types for cleaner matching.
        const ttUpdates: string[] = [];
        const ttValues: unknown[] = [eventId];
        if (tt.availableCount !== undefined) {
          // `capacity_remaining` v DB neexistuje — sloupec je `remaining_qty`
          ttUpdates.push(`remaining_qty = LEAST(remaining_qty, $${ttValues.push(tt.availableCount)})`);
        }
        if (tt.price !== undefined) {
          // stejne tak `price_halire` — sloupec je `base_price`
          ttUpdates.push(`base_price = $${ttValues.push(tt.price)}`);
        }
        if (tt.status) {
          ttUpdates.push(`status = $${ttValues.push(tt.status)}`);
        }
        if (ttUpdates.length > 0) {
          // ticket_types NEMA sloupec updated_at (odstraneno; nezamenovat
          // s dynamic_price_updated_at, ktere zustava) — REMEDIATION 6.
          // catalog.events ho MA, proto radek 92 zustava beze zmeny.
          await db().query(
            `UPDATE catalog.ticket_types SET ${ttUpdates.join(', ')}
             WHERE event_id = $1 AND name = $${ttValues.push(tt.externalId)}`,
            ttValues,
          );
        }
      }
    }

    return NextResponse.json({ ok: true, eventId }, { headers: b2bResponseHeaders(ctx) });
  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ externalId: string }> }): Promise<Response> {
  const params = await props.params;
  const ctx = await verifyB2bToken(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: b2bResponseHeaders() });
  }
  if (!ctx.scope.includes('publish:write') && !ctx.scope.includes('*')) {
    return NextResponse.json({ error: 'INSUFFICIENT_SCOPE' }, { status: 403, headers: b2bResponseHeaders(ctx) });
  }

  return runWithPromoterContext(ctx.promoterId, async () => {
    const evRes = await resolveEvent(ctx, params.externalId);
    if (evRes.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: b2bResponseHeaders(ctx) });
    }
    const eventId = evRes.rows[0].id;

    await db().query(
      `UPDATE catalog.events SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [eventId],
    );

    return NextResponse.json({ ok: true, eventId, status: 'cancelled' }, { headers: b2bResponseHeaders(ctx) });
  });
}
