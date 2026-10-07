/**
 * GET  /api/transfer/accept/[token]  — vrátí preview (kdo posílá, jaký lístek)
 * POST /api/transfer/accept/[token]  — recipient přijme (musí být přihlášen)
 *
 * TM-style P2P accept flow. Token žije 7 dní. Po accept:
 *   - tickets.tickets.owner_id přepíše na recipient
 *   - tickets.ticket_transfers audit row (transfer_type='gift')
 *   - transfer_invitations.status = 'accepted'
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';


export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }): Promise<Response> {
  const params = await props.params;
  return runWithServiceContext(async () => {

  const r = await db().query<{
    id: string;
    ticket_id: string;
    from_email: string;
    from_name: string | null;
    to_email: string;
    message: string | null;
    expires_at: string;
    status: string;
    event_title: string;
    event_date: string;
    venue_name: string | null;
  }>(
    `SELECT ti.id, ti.ticket_id, fu.email AS from_email, fu.name AS from_name,
            ti.to_email, ti.message, ti.expires_at::text, ti.status,
            e.title AS event_title, e.date_start::text AS event_date,
            v.name AS venue_name
       FROM tickets.transfer_invitations ti
       JOIN identity.users fu ON fu.id = ti.from_user_id
       JOIN tickets.tickets t ON t.id = ti.ticket_id
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
      WHERE ti.invite_token = $1`,
    [params.token],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 404 });
  }
  const inv = r.rows[0];
  if (inv.status !== 'pending') {
    return NextResponse.json({ error: 'ALREADY_RESOLVED', status: inv.status }, { status: 410 });
  }
  if (new Date(inv.expires_at) < new Date()) {
    return NextResponse.json({ error: 'EXPIRED' }, { status: 410 });
  }

  return NextResponse.json({
    invitationId: inv.id,
    // Kolo 4: e-mail odesílatele se v náhledu podle tokenu nevrací — jen jméno.
    from: { name: inv.from_name },
    toEmail: inv.to_email,
    message: inv.message,
    expiresAt: inv.expires_at,
    event: {
      title: inv.event_title,
      date: inv.event_date,
      venueName: inv.venue_name,
    },
  });

  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }): Promise<Response> {
  const params = await props.params;
  return runWithServiceContext(async () => {

  const recipientUserId = req.headers.get('x-user-id');
  if (!recipientUserId) {
    return NextResponse.json({ error: 'MUST_BE_LOGGED_IN' }, { status: 401 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const inv = await client.query<{
      id: string;
      ticket_id: string;
      from_user_id: string;
      to_email: string;
      status: string;
      expires_at: string;
    }>(
      `SELECT id, ticket_id, from_user_id, to_email, status, expires_at::text
         FROM tickets.transfer_invitations
        WHERE invite_token = $1
        FOR UPDATE`,
      [params.token],
    );

    if (inv.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 404 });
    }
    const row = inv.rows[0];
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'ALREADY_RESOLVED', status: row.status }, { status: 410 });
    }
    if (new Date(row.expires_at) < new Date()) {
      await client.query('UPDATE tickets.transfer_invitations SET status = \'expired\' WHERE id = $1', [row.id]);
      await client.query('COMMIT');
      return NextResponse.json({ error: 'EXPIRED' }, { status: 410 });
    }

    if (row.from_user_id === recipientUserId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'CANT_ACCEPT_OWN_TRANSFER' }, { status: 422 });
    }

    // Verify email match (optional — recipient musí být logged in jako to_email)
    const recipientCheck = await client.query<{ email: string }>(
      `SELECT email FROM identity.users WHERE id = $1`,
      [recipientUserId],
    );
    if (recipientCheck.rows.length === 0 ||
        recipientCheck.rows[0].email.toLowerCase() !== row.to_email.toLowerCase()) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'EMAIL_MISMATCH' }, { status: 403 });
    }

    // Přepíšeme ownership + audit
    await client.query(
      `UPDATE tickets.tickets
          SET owner_id = $1, updated_at = now()
        WHERE id = $2 AND status = 'valid'`,
      [recipientUserId, row.ticket_id],
    );

    await client.query(
      `INSERT INTO tickets.ticket_transfers (ticket_id, from_user_id, to_user_id, transfer_type)
       VALUES ($1, $2, $3, 'gift')`,
      [row.ticket_id, row.from_user_id, recipientUserId],
    );

    await client.query(
      `UPDATE tickets.transfer_invitations
          SET status = 'accepted', accepted_at = now(), to_user_id = $1
        WHERE id = $2`,
      [recipientUserId, row.id],
    );

    await client.query('COMMIT');
    return NextResponse.json({ accepted: true, ticketId: row.ticket_id });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[transfer/accept]', e);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
