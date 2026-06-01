/**
 * GET/PATCH /api/buyer/tickets/[ticketId]/attendee
 *
 * Edit attendee info per ticket — Eventbrite "Each attendee" mode.
 * Buyer (kupec) může editovat jméno/email osoby, která lístek dostane.
 *
 * Audit log do tickets.attendee_info_log.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';


const patchSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().max(20).optional(),
});

async function ensureOwnership(ticketId: string, userId: string): Promise<boolean> {
  // Buyer (kupec) může edit přes order, ale i current owner po transferu
  const r = await db().query(
    `SELECT 1 FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
      WHERE t.id = $1 AND (t.owner_id = $2 OR o.user_id = $2)`,
    [ticketId, userId],
  );
  return r.rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  if (!(await ensureOwnership(params.ticketId, userId))) {
    return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
  }

  const r = await db().query<{
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    updated_at: string;
  }>(
    `SELECT first_name, last_name, email, phone, updated_at::text
       FROM tickets.attendee_info WHERE ticket_id = $1`,
    [params.ticketId],
  );

  if (r.rows.length === 0) {
    // Fallback: vrátí buyer info z orders/users
    const buyerInfo = await db().query<{
      first_name: string | null;
      last_name: string | null;
      email: string;
      phone: string | null;
    }>(
      `SELECT u.first_name, u.last_name, u.email, u.phone
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN identity.users u ON u.id = o.user_id
        WHERE t.id = $1`,
      [params.ticketId],
    );
    return NextResponse.json({
      attendee: buyerInfo.rows[0] ?? null,
      hasCustomInfo: false,
    });
  }

  return NextResponse.json({ attendee: r.rows[0], hasCustomInfo: true });

  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  if (!(await ensureOwnership(params.ticketId, userId))) {
    return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Load existing info pro audit log
    const existing = await client.query<{
      first_name: string | null; last_name: string | null;
      email: string | null; phone: string | null;
    }>(
      `SELECT first_name, last_name, email, phone
         FROM tickets.attendee_info WHERE ticket_id = $1`,
      [params.ticketId],
    );

    const old = existing.rows[0] ?? { first_name: null, last_name: null, email: null, phone: null };

    // UPSERT
    await client.query(
      `INSERT INTO tickets.attendee_info
         (ticket_id, first_name, last_name, email, phone, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (ticket_id) DO UPDATE SET
         first_name = COALESCE(EXCLUDED.first_name, tickets.attendee_info.first_name),
         last_name = COALESCE(EXCLUDED.last_name, tickets.attendee_info.last_name),
         email = COALESCE(EXCLUDED.email, tickets.attendee_info.email),
         phone = COALESCE(EXCLUDED.phone, tickets.attendee_info.phone),
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = now()`,
      [
        params.ticketId,
        parsed.data.firstName ?? null,
        parsed.data.lastName ?? null,
        parsed.data.email ?? null,
        parsed.data.phone ?? null,
        userId,
      ],
    );

    // Audit log changes per field
    const fields = [
      ['first_name', old.first_name, parsed.data.firstName],
      ['last_name', old.last_name, parsed.data.lastName],
      ['email', old.email, parsed.data.email],
      ['phone', old.phone, parsed.data.phone],
    ];
    for (const [field, oldVal, newVal] of fields) {
      if (newVal !== undefined && newVal !== oldVal) {
        await client.query(
          `INSERT INTO tickets.attendee_info_log
             (ticket_id, field_name, old_value, new_value, changed_by_user_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [params.ticketId, field, oldVal, newVal, userId],
        );
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
