import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const schema = z.object({
  token: z.string().min(1).max(200),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    const ownerCheck = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog.events
       WHERE id = $1 AND promoter_id = $2`,
      [eventId, promoter.promoterId],
    );
    if (Number(ownerCheck.rows[0]?.count ?? 0) === 0) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const tokenValue = parsed.data.token;

    const entryRes = await db().query<{
      id: string;
      guest_name: string;
      notes: string | null;
      status: string;
      ticket_id: string | null;
    }>(
      `SELECT ge.id, ge.guest_name, ge.notes, ge.status, ge.ticket_id
       FROM orders.guestlist_entries ge
       JOIN tickets.tickets t ON t.id = ge.ticket_id
       WHERE ge.event_id = $1
         AND (
           t.id::text = $2
           OR ge.guest_email = $2
         )
       LIMIT 1`,
      [eventId, tokenValue],
    );

    if (entryRes.rows.length === 0) {
      return NextResponse.json({ admitted: false, reason: 'NOT_FOUND' }, { status: 404 });
    }

    const entry = entryRes.rows[0];

    if (entry.status === 'cancelled') {
      return NextResponse.json({
        admitted: false,
        reason: 'CANCELLED',
        guestName: entry.guest_name,
        notes: entry.notes,
      });
    }

    if (entry.status === 'attended') {
      return NextResponse.json({
        admitted: false,
        reason: 'ALREADY_CHECKED_IN',
        guestName: entry.guest_name,
        notes: entry.notes,
      });
    }

    await db().query(
      `UPDATE orders.guestlist_entries
       SET status = 'attended', checked_in_at = COALESCE(checked_in_at, NOW()), updated_at = NOW()
       WHERE id = $1`,
      [entry.id],
    );

    if (entry.ticket_id) {
      await db().query(
        `UPDATE tickets.tickets
         SET status = 'used', used_at = COALESCE(used_at, NOW()), updated_at = NOW()
         WHERE id = $1 AND status = 'valid'`,
        [entry.ticket_id],
      );
    }

    return NextResponse.json({
      admitted: true,
      guestName: entry.guest_name,
      notes: entry.notes,
    });
  });
}
