/**
 * GET  /api/admin/events/[id]/comps  — seznam všech comp vstupenek (press + VIP + artist + …)
 * POST /api/admin/events/[id]/comps  — vydej comp vstupenky (0 Kč, zvolený ticket type + reason)
 *
 * Comp = complimentary (bezplatná vstupenka). Kategorie:
 *   press    — média / novináři
 *   vip      — VIP hosté, sponzoři
 *   artist   — vystupující, crew
 *   sponsor  — obchodní partneři
 *   staff    — vlastní personál
 *   other    — jiné
 *
 * Vydané compy jsou reálné orders (total_amount=0, payment_provider='comp', status='paid')
 * s comp_type pro accounting + audit. Inventory se dekrementuje normálně.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const COMP_TYPES = ['press', 'vip', 'artist', 'sponsor', 'staff', 'other'] as const;

const postSchema = z.object({
  ticketTypeId: z.string().uuid(),
  recipientEmail: z.string().email().max(320),
  recipientName: z.string().min(1).max(200),
  compType: z.enum(COMP_TYPES),
  quantity: z.number().int().min(1).max(20).default(1),
  notes: z.string().max(500).optional(),
});

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const r = await db().query<{
      order_id: string;
      comp_type: string;
      comp_notes: string | null;
      recipient_email: string;
      recipient_name: string | null;
      ticket_type_name: string;
      quantity: string;
      created_at: string;
      ticket_ids: string;
    }>(
      `SELECT
         o.id AS order_id,
         o.comp_type,
         o.comp_notes,
         u.email AS recipient_email,
         u.name AS recipient_name,
         tt.name AS ticket_type_name,
         SUM(oi.quantity)::text AS quantity,
         o.created_at::text,
         STRING_AGG(t.id::text, ',') AS ticket_ids
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       LEFT JOIN tickets.tickets t ON t.order_id = o.id
       WHERE o.event_id = $1
         AND o.comp_type IS NOT NULL
         AND o.status = 'paid'
       GROUP BY o.id, o.comp_type, o.comp_notes, u.email, u.name, tt.name, o.created_at
       ORDER BY o.created_at DESC`,
      [eventId],
    );

    // Summary by comp_type
    const summary: Record<string, number> = {};
    for (const row of r.rows) {
      summary[row.comp_type] = (summary[row.comp_type] ?? 0) + Number(row.quantity);
    }

    return NextResponse.json({
      comps: r.rows.map((row) => ({
        orderId: row.order_id,
        compType: row.comp_type,
        compNotes: row.comp_notes,
        recipientEmail: row.recipient_email,
        recipientName: row.recipient_name,
        ticketTypeName: row.ticket_type_name,
        quantity: Number(row.quantity),
        createdAt: row.created_at,
        ticketIds: row.ticket_ids ? row.ticket_ids.split(',') : [],
      })),
      summary,
      totalComps: r.rows.reduce((acc, row) => acc + Number(row.quantity), 0),
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // Verify ticket type belongs to event + get currency
      const ttRes = await client.query<{
        id: string;
        name: string;
        currency: string;
        remaining_qty: number | null;
      }>(
        `SELECT tt.id, tt.name, e.currency,
                tt.remaining_qty
         FROM catalog.ticket_types tt
         JOIN catalog.events e ON e.id = tt.event_id
         WHERE tt.id = $1 AND tt.event_id = $2 AND tt.is_published = TRUE`,
        [input.ticketTypeId, eventId],
      );
      if (ttRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'TICKET_TYPE_NOT_FOUND', message: 'Typ vstupenky nenalezen nebo není aktivní.' },
          { status: 404 },
        );
      }
      const tt = ttRes.rows[0];

      // Inventory check (comps still decrement remaining_qty)
      if (tt.remaining_qty !== null && tt.remaining_qty < input.quantity) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'INSUFFICIENT_INVENTORY',
            message: `Zbývá pouze ${tt.remaining_qty} ks, požadujete ${input.quantity} comp ks.`,
            remainingQty: tt.remaining_qty,
          },
          { status: 409 },
        );
      }

      // Resolve or create recipient user
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
         VALUES (LOWER($1), $2, '!guest', NOW(), NOW(), NOW())
         ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE
           SET name = COALESCE(EXCLUDED.name, identity.users.name),
               updated_at = NOW()
         RETURNING id`,
        [input.recipientEmail.toLowerCase().trim(), input.recipientName],
      );
      const userId = userRes.rows[0].id;

      // Create comp order (total_amount=0, payment_provider='comp', status='paid')
      const orderId = randomUUID();
      await client.query(
        `INSERT INTO orders.orders
           (id, user_id, event_id, status, total_amount, currency, locale,
            gopay_payment_id, payment_provider, idempotency_key,
            discount_halire, requires_age_verification, paid_at,
            expires_at, comp_type, comp_notes, created_at, updated_at)
         VALUES ($1, $2, $3, 'paid', 0, $4, 'cs',
                 $5, 'comp', $6,
                 0, FALSE, NOW(),
                 NOW() + INTERVAL '7 days',
                 $7, $8, NOW(), NOW())`,
        [
          orderId,
          userId,
          eventId,
          tt.currency,
          `comp-${randomUUID().slice(0, 8)}`,
          randomUUID(),
          input.compType,
          input.notes ?? null,
        ],
      );

      await client.query(
        `INSERT INTO orders.order_items
           (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, 0, 0)`,
        [orderId, tt.id, input.quantity],
      );

      // Atomically decrement inventory (comps count against capacity)
      if (tt.remaining_qty !== null) {
        const decrRes = await client.query<{ remaining_qty: number }>(
          `UPDATE catalog.ticket_types
           SET remaining_qty = remaining_qty - $1
           WHERE id = $2 AND remaining_qty >= $1
           RETURNING remaining_qty`,
          [input.quantity, tt.id],
        );
        if (decrRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'INVENTORY_RACE', message: 'Inventář byl vyčerpán souběžně, zkuste znovu.' },
            { status: 409 },
          );
        }
      }

      const issued = await issueTicketsForOrder(orderId, client);
      await client.query('COMMIT');

      return NextResponse.json(
        {
          ok: true,
          orderId,
          compType: input.compType,
          recipientEmail: input.recipientEmail,
          ticketTypeName: tt.name,
          quantity: input.quantity,
          ticketIds: issued.map((t) => t.ticketId),
        },
        { status: 201 },
      );
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[POST /api/admin/events/[id]/comps]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
