/**
 * GET  /api/buyer/tickets/[ticketId]/picks → current picks + available days + flex settings
 * POST /api/buyer/tickets/[ticketId]/picks → body { dayIds: string[] }
 *
 * Pravidla:
 *   - musí být flex pass (pass_kind='flex')
 *   - dayIds.length === picks_required
 *   - každé event_day patří k events ticket_type.event_id
 *   - před pick_deadline (pokud nastaven)
 *   - replacement strategie: atomicky DELETE + INSERT (nelze měnit po prvním scan)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import type { Pool } from 'pg';
import { z } from 'zod';


interface OwnedTicketRow {
  id: string;
  ticket_type_id: string;
  event_id: string;
  status: string;
  picks_required: number | null;
  pass_kind: string | null;
  pick_deadline: string | null;
}

async function loadTicket(client: { query: Pool['query'] }, ticketId: string, userId: string): Promise<OwnedTicketRow | null> {
  const r = await client.query<OwnedTicketRow>(
    `SELECT t.id, t.ticket_type_id, t.status,
            o.event_id,
            f.picks_required, f.pass_kind, f.pick_deadline
     FROM tickets.tickets t
     JOIN orders.orders o ON o.id = t.order_id
     LEFT JOIN catalog.flex_pass_settings f ON f.ticket_type_id = t.ticket_type_id
     WHERE t.id = $1 AND t.owner_id = $2`,
    [ticketId, userId],
  );
  return r.rows[0] ?? null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const ticket = await loadTicket(db() as unknown as Pool, ctx.params.ticketId, userId);
  if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!ticket.pass_kind) {
    return NextResponse.json({ error: 'NOT_A_PASS' }, { status: 422 });
  }

  const days = await db().query<{
    id: string;
    label: string | null;
    starts_at: string;
    ends_at: string | null;
  }>(
    `SELECT id, label, starts_at, ends_at FROM catalog.event_days
     WHERE event_id = $1 ORDER BY day_index`,
    [ticket.event_id],
  );

  const picks = await db().query<{ event_day_id: string; picked_at: string }>(
    `SELECT event_day_id, picked_at FROM tickets.ticket_picks WHERE ticket_id = $1`,
    [ctx.params.ticketId],
  );

  const usedDayIds = await db().query<{ event_day_id: string }>(
    `SELECT event_day_id FROM tickets.ticket_redemptions WHERE ticket_id = $1`,
    [ctx.params.ticketId],
  );

  return NextResponse.json({
    ticketId: ticket.id,
    passKind: ticket.pass_kind,
    picksRequired: ticket.picks_required,
    pickDeadline: ticket.pick_deadline,
    days: days.rows,
    picks: picks.rows,
    usedDayIds: usedDayIds.rows.map((r) => r.event_day_id),
    locked: ticket.pass_kind !== 'flex',
  });

  });
}

const postSchema = z.object({
  dayIds: z.array(z.string().uuid()).min(1).max(100),
});

export async function POST(
  req: NextRequest,
  ctx: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const dayIds = Array.from(new Set(parsed.data.dayIds));

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const ticket = await loadTicket(client, ctx.params.ticketId, userId);
    if (!ticket) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (ticket.pass_kind !== 'flex') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FLEX' }, { status: 422 });
    }
    if (ticket.picks_required !== null && dayIds.length !== ticket.picks_required) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'WRONG_PICK_COUNT',
          required: ticket.picks_required,
          received: dayIds.length,
        },
        { status: 422 },
      );
    }
    if (ticket.pick_deadline && new Date(ticket.pick_deadline).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'PICK_DEADLINE_PASSED', deadline: ticket.pick_deadline },
        { status: 409 },
      );
    }

    // Validate days patří k tomuto eventu
    const validDays = await client.query<{ id: string }>(
      `SELECT id FROM catalog.event_days
       WHERE event_id = $1 AND id = ANY($2::uuid[])`,
      [ticket.event_id, dayIds],
    );
    if (validDays.rows.length !== dayIds.length) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'DAY_NOT_IN_EVENT' },
        { status: 422 },
      );
    }

    // Nelze měnit picks pokud už byl ticket scannován
    const used = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tickets.ticket_redemptions WHERE ticket_id = $1`,
      [ctx.params.ticketId],
    );
    if (Number(used.rows[0]?.count ?? 0) > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'ALREADY_SCANNED', message: 'Pass už byl použit, picks nelze měnit.' },
        { status: 409 },
      );
    }

    await client.query(
      `DELETE FROM tickets.ticket_picks WHERE ticket_id = $1`,
      [ctx.params.ticketId],
    );
    for (const d of dayIds) {
      await client.query(
        `INSERT INTO tickets.ticket_picks (ticket_id, event_day_id) VALUES ($1, $2)`,
        [ctx.params.ticketId, d],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, picks: dayIds });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[buyer picks]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
