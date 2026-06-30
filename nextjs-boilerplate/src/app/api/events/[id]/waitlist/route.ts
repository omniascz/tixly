import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const postSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  ticketTypeId: z.string().uuid().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const totalRes = await db().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM orders.waiting_list
       WHERE event_id = $1 AND status = 'waiting'`,
      [params.id],
    );
    const posRes = await db().query<{ position: string }>(
      `SELECT COUNT(*)::text AS position FROM orders.waiting_list
       WHERE event_id = $1 AND status IN ('waiting', 'offered', 'converted')`,
      [params.id],
    );
    return NextResponse.json({
      totalWaiting: Number(totalRes.rows[0]?.total ?? 0),
      position: Number(posRes.rows[0]?.position ?? 0),
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  return runWithServiceContext(async () => {
    const eventRes = await db().query<{ id: string; title: string; date_start: string }>(
      `SELECT id, title, date_start FROM catalog.events WHERE id = $1 AND status = 'published'`,
      [params.id],
    );
    if (eventRes.rows.length === 0) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const soldOutCheck = await db().query<{ remaining: string | null }>(
      `SELECT SUM(remaining_qty)::text AS remaining FROM catalog.ticket_types
       WHERE event_id = $1`,
      [params.id],
    );
    const remaining = Number(soldOutCheck.rows[0]?.remaining ?? 0);
    if (remaining > 0) {
      return NextResponse.json(
        { error: 'Vstupenky jsou stále k dispozici' },
        { status: 409 },
      );
    }

    const existing = await db().query<{ id: string; position: number }>(
      `SELECT id, position FROM orders.waiting_list
       WHERE event_id = $1 AND LOWER(email) = LOWER($2) AND status <> 'cancelled'`,
      [params.id, parsed.data.email],
    );
    if (existing.rows.length > 0) {
      return NextResponse.json({
        waitlistId: existing.rows[0].id,
        position: existing.rows[0].position,
        estimatedWait: null,
        existing: true,
      });
    }

    const posRes = await db().query<{ maxpos: string | null }>(
      `SELECT MAX(position)::text AS maxpos FROM orders.waiting_list WHERE event_id = $1`,
      [params.id],
    );
    const nextPosition = Number(posRes.rows[0]?.maxpos ?? 0) + 1;

    const r = await db().query<{ id: string }>(
      `INSERT INTO orders.waiting_list (event_id, ticket_type_id, email, name, position)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        params.id,
        parsed.data.ticketTypeId ?? null,
        parsed.data.email.toLowerCase(),
        parsed.data.name ?? null,
        nextPosition,
      ],
    );

    return NextResponse.json(
      { waitlistId: r.rows[0].id, position: nextPosition, estimatedWait: null },
      { status: 201 },
    );
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const email = req.nextUrl.searchParams.get('email');
  const token = req.nextUrl.searchParams.get('token');
  if (!email || !token) {
    return NextResponse.json({ error: 'email and token required' }, { status: 400 });
  }

  return runWithServiceContext(async () => {
    const r = await db().query<{ id: string }>(
      `UPDATE orders.waiting_list SET status = 'cancelled'
       WHERE event_id = $1 AND id = $2::uuid AND LOWER(email) = LOWER($3)
         AND status NOT IN ('converted', 'cancelled')
       RETURNING id`,
      [params.id, token, email],
    );
    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
