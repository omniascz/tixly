/**
 * POST /api/buyer/group-invitations/reserve  (AXS Invite — adjacent seat hold)
 *
 * Body: { eventId, ticketTypeId, seatCount (2..10), message? }
 *
 * Organizátor drží N SOUSEDNÍCH sedadel (stejný sektor + řada). Vytvoří group
 * invitation s 48h hold. Přátelé pak claimnou své sedadlo (/group/[token]),
 * nezaplacená sedadla se po 48 h uvolní (cron release-group-invite-holds).
 */
import { randomBytes } from 'crypto';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  seatCount: z.number().int().min(2).max(10),
  message: z.string().max(500).optional(),
});

function token(): string {
  return randomBytes(24).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    const { eventId, ticketTypeId, seatCount, message } = parsed.data;
    const inviteToken = token();

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Kolo 3: kontrola akce a typu pod kontextem kupce; zámek/držení sedadel a INSERT pozvánky jsou systémové (asSystemInTx).

      const ev = await client.query<{ id: string }>(
        `SELECT id FROM catalog.events WHERE id = $1 AND status = 'published'`,
        [eventId],
      );
      if (!ev.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
      }

      const tt = await client.query(
        `SELECT 1 FROM catalog.ticket_types WHERE id = $1 AND event_id = $2`,
        [ticketTypeId, eventId],
      );
      if (tt.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_TYPE_NOT_IN_EVENT' }, { status: 422 });
      }

      // Najdi řadu se ≥ seatCount volnými sedadly daného typu, vrať seatCount
      // z ní (seřazeno dle čísla sedadla = sousední). Lock FOR UPDATE.
      const seats = await asSystemInTx(client, () => client.query<{ id: string; sector: string | null; row: string | null; seat_number: string | null }>(
        `SELECT s.id, s.sector, s.row, s.seat_number
           FROM catalog.event_seats s
           JOIN (
             SELECT sector, row
               FROM catalog.event_seats
              WHERE event_id = $1 AND status = 'available' AND ticket_type_id = $2
              GROUP BY sector, row
             HAVING COUNT(*) >= $3
              ORDER BY COUNT(*) ASC
              LIMIT 1
           ) pick ON pick.sector IS NOT DISTINCT FROM s.sector AND pick.row IS NOT DISTINCT FROM s.row
          WHERE s.event_id = $1 AND s.status = 'available' AND s.ticket_type_id = $2
          ORDER BY NULLIF(regexp_replace(COALESCE(s.seat_number,''), '\\D', '', 'g'), '')::int NULLS LAST, s.seat_number
          LIMIT $3
          FOR UPDATE OF s`,
        [eventId, ticketTypeId, seatCount],
      ));
      if (seats.rows.length < seatCount) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'NO_ADJACENT_SEATS', message: `Nenašli jsme ${seatCount} sousedních volných sedadel.` },
          { status: 409 },
        );
      }
      const seatIds = seats.rows.map((s) => s.id);

      // Drž sedadla 48 h
      await asSystemInTx(client, () => client.query(
        `UPDATE catalog.event_seats
            SET status = 'held', hold_kind = 'group_invite',
                hold_until = NOW() + INTERVAL '48 hours', hold_user_id = $2,
                updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [seatIds, userId],
      ));

      const inv = await asSystemInTx(client, () => client.query<{ id: string; expires_at: string }>(
        `INSERT INTO orders.group_invitations
           (organizer_user_id, event_id, ticket_type_id, target_seats, invite_token, message,
            adjacent_reserve, held_seat_ids, hold_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7::uuid[], NOW() + INTERVAL '48 hours')
         RETURNING id, expires_at::text`,
        [userId, eventId, ticketTypeId, seatCount, inviteToken, message ?? null, seatIds],
      ));
      await client.query('COMMIT');

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      return NextResponse.json({
        ok: true,
        invitationId: inv.rows[0].id,
        inviteToken,
        inviteUrl: `${baseUrl}/cs/group/${inviteToken}`,
        seats: seats.rows.map((s) => ({
          id: s.id,
          label: `${s.sector ?? ''} řada ${s.row ?? '?'} · sedadlo ${s.seat_number ?? '?'}`.trim(),
        })),
        holdExpiresAt: inv.rows[0].expires_at,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[POST /api/buyer/group-invitations/reserve]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
