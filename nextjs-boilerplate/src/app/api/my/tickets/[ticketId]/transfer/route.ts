import { randomBytes } from 'crypto';
/**
 * POST /api/my/tickets/[ticketId]/transfer
 *
 * Zahájí přesun vstupenky na jiného uživatele.
 * Body: { toEmail: string }
 * Vrací token, který příjemce použije na /transfer/[token]
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithUserContext } from '@/lib/db/rls-pool';

async function GETImpl(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const client = await db().connect();
  try {
    const r = await client.query(
      `SELECT tt.id, tt.status, tt.transfer_count, tt.transfer_status,
              et.title AS event_title, et.date_start,
              tty.name AS ticket_type_name,
              tr.to_email, tr.expires_at, tr.status AS pending_status
         FROM tickets.tickets tt
         JOIN orders.orders o ON o.id = tt.order_id
         JOIN catalog.events et ON et.id = o.event_id
         JOIN catalog.ticket_types tty ON tty.id = tt.ticket_type_id
         LEFT JOIN orders.ticket_transfers tr ON tr.ticket_id = tt.id AND tr.status = 'pending'
        WHERE tt.id = $1 AND tt.owner_id = $2`,
      [params.ticketId, userId],
    );
    if (r.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ticket: r.rows[0] });
  } finally {
    client.release();
  }
}

async function POSTImpl(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: { toEmail?: string };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const toEmail = (body.toEmail ?? '').trim().toLowerCase();
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return NextResponse.json({ error: 'INVALID_EMAIL' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Verify ownership + ticket valid
    const ticketRes = await client.query<{
      id: string; status: string; transfer_count: number; order_id: string; event_date: string;
    }>(
      `SELECT tt.id, tt.status, tt.transfer_count, tt.order_id, et.date_start AS event_date
         FROM tickets.tickets tt
         JOIN orders.orders o ON o.id = tt.order_id
         JOIN catalog.events et ON et.id = o.event_id
        WHERE tt.id = $1 AND tt.owner_id = $2
        FOR UPDATE OF tt`,
      [params.ticketId, userId],
    );

    if (ticketRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const ticket = ticketRes.rows[0];
    if (ticket.status !== 'valid') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'TICKET_NOT_TRANSFERABLE' }, { status: 409 });
    }
    if (new Date(ticket.event_date) < new Date()) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'EVENT_ALREADY_STARTED' }, { status: 409 });
    }

    // Cancel any existing pending transfer
    await client.query(
      `UPDATE orders.ticket_transfers SET status='cancelled' WHERE ticket_id=$1 AND status='pending'`,
      [params.ticketId],
    );

    // Find from_user email
    const fromUserRes = await client.query<{ email: string }>(
      `SELECT email FROM identity.users WHERE id=$1`, [userId],
    );

    // Create transfer record
    // Tri vrstvy najednou (PEEL):
    //  1. transfer_token mel DEFAULT encode(…, 'base64url') → 22023 (mig 456)
    //  2. order_id je NOT NULL a INSERT ho nedodaval → 23502
    //  3. sloupec se jmenuje transfer_token, kod cetl `RETURNING token` → 42703
    const transferRes = await client.query<{ transfer_token: string }>(
      `INSERT INTO orders.ticket_transfers (ticket_id, order_id, from_user_id, to_email, transfer_token)
       VALUES ($1,$2,$3,$4,$5) RETURNING transfer_token`,
      [params.ticketId, ticket.order_id, userId, toEmail, randomBytes(24).toString('base64url')],
    );

    // Mark ticket as pending transfer
    await client.query(
      `UPDATE tickets.tickets SET transfer_status='pending_transfer' WHERE id=$1`,
      [params.ticketId],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      token: transferRes.rows[0].transfer_token,
      toEmail,
      fromEmail: fromUserRes.rows[0]?.email,
      expiresIn: '72h',
    }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/my/tickets/:id/transfer]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

async function DELETEImpl(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const r = await client.query(
      `UPDATE orders.ticket_transfers SET status='cancelled'
        WHERE ticket_id=$1 AND from_user_id=$2 AND status='pending'
        RETURNING id`,
      [params.ticketId, userId],
    );
    if ((r.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE tickets.tickets SET transfer_status=NULL WHERE id=$1`,
        [params.ticketId],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ cancelled: (r.rowCount ?? 0) > 0 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

// Obaleno kontextem vlastnika (FINDINGS 96): tabulky ticket_transfers/tickets maji
// RLS vazanou na app.current_user_id; bez GUC pod tixly_app nevidi route nic.
// Handlery jsou obalene KAZDY ZVLAST — jeden spolecny wrapper by tu nesel,
// protoze userId se cte az uvnitr z hlavicky.
type Ctx = { params: { ticketId: string } };
const withUser = (
  impl: (r: NextRequest, c: Ctx) => Promise<Response>,
) => async (req: NextRequest, ctx: { params: Promise<Ctx['params']> }): Promise<Response> => {
  const uid = req.headers.get('x-user-id');
  if (!uid) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const params = await ctx.params; // Next 15: params je Promise
  return runWithUserContext(uid, () => impl(req, { params }));
};

export const GET = withUser(GETImpl);
export const POST = withUser(POSTImpl);
export const DELETE = withUser(DELETEImpl);
