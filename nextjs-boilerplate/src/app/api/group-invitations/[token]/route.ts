/**
 * GET /api/group-invitations/[token] — public group invite preview
 *
 * Vrací: organizer info, event, target_seats, progress (already_paid count),
 * checkout URL pro friend.
 *
 * CZ priority #5 (FR/UK/IT audit). Public, no auth.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';


export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {

  if (!/^[A-Za-z0-9_-]{20,80}$/.test(params.token)) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: servisní kontext (runWithServiceContext) stačí — politiky mají větev app_is_service(); admin eskalace odstraněna.

    const inv = await client.query<{
      id: string;
      organizer_user_id: string;
      organizer_email: string;
      organizer_name: string | null;
      event_id: string;
      event_title: string;
      event_date_start: string;
      ticket_type_id: string | null;
      target_seats: number;
      message: string | null;
      status: string;
      expires_at: string;
      adjacent_reserve: boolean;
      held_seat_ids: string[];
      hold_expires_at: string | null;
    }>(
      `SELECT gi.id, gi.organizer_user_id, u.email AS organizer_email,
              u.name AS organizer_name,
              gi.event_id, e.title AS event_title,
              e.date_start::text AS event_date_start,
              gi.ticket_type_id, gi.target_seats, gi.message,
              gi.status, gi.expires_at::text,
              gi.adjacent_reserve, gi.held_seat_ids, gi.hold_expires_at::text
         FROM orders.group_invitations gi
         JOIN identity.users u ON u.id = gi.organizer_user_id
         JOIN catalog.events e ON e.id = gi.event_id
        WHERE gi.invite_token = $1`,
      [params.token],
    );

    if (inv.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'INVITATION_NOT_FOUND' }, { status: 404 });
    }
    const i = inv.rows[0];

    // Aggregate progress: kolik paid orders už linkováno
    const progress = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM orders.orders
        WHERE group_invitation_id = $1 AND status = 'paid'`,
      [i.id],
    );
    const alreadyPaid = Number(progress.rows[0].count);

    // AXS Invite: seznam držených sousedních sedadel + claim status
    let seats: { id: string; label: string; claimed: boolean }[] = [];
    if (i.adjacent_reserve && i.held_seat_ids.length > 0) {
      const sr = await client.query<{
        id: string; sector: string | null; row: string | null;
        seat_number: string | null; status: string; hold_kind: string | null;
      }>(
        `SELECT id, sector, row, seat_number, status, hold_kind
           FROM catalog.event_seats WHERE id = ANY($1::uuid[])
          ORDER BY NULLIF(regexp_replace(COALESCE(seat_number,''), '\\D', '', 'g'), '')::int NULLS LAST, seat_number`,
        [i.held_seat_ids],
      );
      seats = sr.rows.map((s) => ({
        id: s.id,
        label: `${s.sector ?? ''} řada ${s.row ?? '?'} · sedadlo ${s.seat_number ?? '?'}`.trim(),
        // claimed = už není volně držené (někdo ho vzal → sold/held-claimed)
        claimed: !(s.status === 'held' && s.hold_kind === 'group_invite'),
      }));
    }

    await client.query('COMMIT');

    return NextResponse.json({
      invitationId: i.id,
      status: i.status,
      expired: new Date(i.expires_at).getTime() < Date.now(),
      // Kolo 4: e-mail a ID organizátora (soukromá osoba) se veřejně nevrací — jen jméno.
      organizer: {
        name: i.organizer_name,
      },
      event: {
        id: i.event_id,
        title: i.event_title,
        dateStart: i.event_date_start,
      },
      ticketTypeId: i.ticket_type_id,
      targetSeats: i.target_seats,
      adjacentReserve: i.adjacent_reserve,
      holdExpiresAt: i.hold_expires_at,
      seats,
      message: i.message,
      progress: {
        alreadyPaid,
        remaining: Math.max(0, i.target_seats - alreadyPaid),
        targetSeats: i.target_seats,
      },
      checkoutUrl: i.ticket_type_id
        ? `/cs/checkout?eventId=${i.event_id}&ticketTypeId=${i.ticket_type_id}&groupInvitation=${params.token}`
        : `/cs/events/${i.event_id}?groupInvitation=${params.token}`,
      expiresAt: i.expires_at,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET /api/group-invitations/[token]]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
