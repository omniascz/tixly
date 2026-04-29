/**
 * POST /api/events/[id]/waitlist
 * Body: { ticketTypeId, email, name?, quantity? }
 *
 * Buyer se přihlásí na waitlist konkrétního ticket type, který je vyprodaný.
 * Idempotent: ten samý email × ticket_type → vrátí existující entry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  ticketTypeId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  quantity: z.number().int().min(1).max(10).default(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const userId = req.headers.get('x-user-id');

  // Validate ticket type belongs to event
  const tt = await db().query<{ id: string; remaining_qty: number | null }>(
    `SELECT tt.id, tt.remaining_qty
     FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id
     WHERE tt.id = $1 AND tt.event_id = $2 AND e.status = 'published'`,
    [parsed.data.ticketTypeId, params.id],
  );
  if (tt.rows.length === 0) {
    return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 });
  }

  // Existing entry? → return it (idempotent)
  const existing = await db().query<{
    id: string;
    status: string;
    created_at: string;
  }>(
    `SELECT id, status, created_at FROM catalog.waitlist_entries
     WHERE ticket_type_id = $1 AND LOWER(email) = LOWER($2)
       AND status IN ('waiting', 'notified')`,
    [parsed.data.ticketTypeId, parsed.data.email],
  );
  if (existing.rows.length > 0) {
    const positionRes = await db().query<{ ahead: string }>(
      `SELECT COUNT(*)::text AS ahead FROM catalog.waitlist_entries
       WHERE ticket_type_id = $1 AND status = 'waiting' AND created_at < $2`,
      [parsed.data.ticketTypeId, existing.rows[0]!.created_at],
    );
    return NextResponse.json({
      id: existing.rows[0]!.id,
      status: existing.rows[0]!.status,
      position: Number(positionRes.rows[0]?.ahead ?? 0) + 1,
      existing: true,
    });
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.waitlist_entries
       (ticket_type_id, user_id, email, name, quantity_requested)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      parsed.data.ticketTypeId,
      userId,
      parsed.data.email.toLowerCase(),
      parsed.data.name ?? null,
      parsed.data.quantity,
    ],
  );

  const positionRes = await db().query<{ ahead: string }>(
    `SELECT COUNT(*)::text AS ahead FROM catalog.waitlist_entries
     WHERE ticket_type_id = $1 AND status = 'waiting'`,
    [parsed.data.ticketTypeId],
  );

  return NextResponse.json(
    {
      id: r.rows[0]!.id,
      status: 'waiting',
      position: Number(positionRes.rows[0]?.ahead ?? 0),
      existing: false,
    },
    { status: 201 },
  );
}
