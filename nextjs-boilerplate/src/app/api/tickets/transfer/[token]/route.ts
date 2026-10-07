/**
 * GET  /api/tickets/transfer/[token] — detail přesunu (pro stránku accept)
 * POST /api/tickets/transfer/[token] — accept přesunu (příjemce)
 */
import { NextRequest, NextResponse } from 'next/server';
import { asSystemInTx, db, runWithServiceContext, runWithUserContext } from '@/lib/db/rls-pool';

async function GETImpl(
  _req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  const client = await db().connect();
  try {
    const r = await client.query(
      `SELECT tr.to_email, tr.expires_at, tr.status,
              tt.id AS ticket_id,
              et.title AS event_title, et.date_start, et.cover_image_url,
              v.name AS venue_name, v.city,
              tty.name AS ticket_type_name
         FROM orders.ticket_transfers tr
         JOIN tickets.tickets tt ON tt.id = tr.ticket_id
         JOIN orders.orders o ON o.id = tt.order_id
         JOIN catalog.events et ON et.id = o.event_id
         JOIN catalog.venues v ON v.id = et.venue_id
         JOIN catalog.ticket_types tty ON tty.id = tt.ticket_type_id
        WHERE tr.transfer_token = $1`,
      [params.token],
    );
    if (r.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const row = r.rows[0] as {
      to_email: string; expires_at: string; status: string;
      ticket_id: string; event_title: string; date_start: string; cover_image_url: string | null;
      venue_name: string; city: string; ticket_type_name: string;
    };
    if (row.status !== 'pending') {
      return NextResponse.json({ error: 'TRANSFER_ALREADY_USED', status: row.status }, { status: 409 });
    }
    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ error: 'TRANSFER_EXPIRED' }, { status: 410 });
    }
    return NextResponse.json({ transfer: row });
  } finally {
    client.release();
  }
}

async function POSTImpl(
  req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const transferRes = await client.query<{
      id: string; ticket_id: string; from_user_id: string; to_email: string; expires_at: string; status: string;
    }>(
      `SELECT id, ticket_id, from_user_id, to_email, expires_at, status
         FROM orders.ticket_transfers WHERE transfer_token=$1 FOR UPDATE`,
      [params.token],
    );

    if (transferRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const tr = transferRes.rows[0];
    if (tr.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'TRANSFER_ALREADY_USED' }, { status: 409 });
    }
    if (new Date(tr.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'TRANSFER_EXPIRED' }, { status: 410 });
    }

    // Verify the claimant's email matches (or they're logged in)
    const userRes = await client.query<{ email: string }>(
      `SELECT email FROM identity.users WHERE id=$1`, [userId],
    );
    const userEmail = userRes.rows[0]?.email?.toLowerCase();
    if (userEmail !== tr.to_email.toLowerCase()) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'EMAIL_MISMATCH' }, { status: 403 });
    }

    // Transfer ownership — kolo 4: dřív v kontextu PŘÍJEMCE, který cizí vstupenku pod RLS
    // nevidí → UPDATE zasáhl 0 řádků bez chyby a převod se přesto označil 'claimed'.
    // Oprávnění je ověřené výše (platný pending převod, e-mail příjemce sedí), změna vlastníka
    // je systémový efekt převodu. Podmínka owner_id = odesílatel brání převzetí vstupenky,
    // která mezitím změnila majitele; nezasáhne-li UPDATE právě 1 řádek, převod se neprovede.
    const moved = await asSystemInTx(client, () => client.query(
      `UPDATE tickets.tickets
          SET owner_id=$1,
              transferred_to_user_id=$1,
              transfer_status='transferred',
              transfer_count = transfer_count + 1
        WHERE id=$2 AND owner_id=$3 AND status='valid'`,
      [userId, tr.ticket_id, tr.from_user_id],
    ));
    if (moved.rowCount !== 1) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'TICKET_NOT_TRANSFERABLE' }, { status: 409 });
    }

    await client.query(
      `UPDATE orders.ticket_transfers SET status='claimed', claimed_at=now() WHERE id=$1`,
      [tr.id],
    );

    await client.query('COMMIT');
    return NextResponse.json({ claimed: true, ticketId: tr.ticket_id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/tickets/transfer/:token]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

// Obaleno kontextem podle vlastnictvi dat (FINDINGS 96):
//  - GET je verejny (nahled prevodu podle tokenu, prijemce jeste neni prihlasen)
//    -> SERVISNI kontext, ne USING (true) v policy. Route si filtruje sama tokenem.
//  - POST prevod prijima prihlaseny uzivatel -> kontext toho uzivatele.
type TCtx = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, ctx: TCtx): Promise<Response> {
  const params = await ctx.params; // Next 15: params je Promise
  return runWithServiceContext(() => GETImpl(req, { params }));
}

export async function POST(req: NextRequest, ctx: TCtx): Promise<Response> {
  const uid = req.headers.get('x-user-id');
  if (!uid) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const params = await ctx.params; // Next 15: params je Promise
  return runWithUserContext(uid, () => POSTImpl(req, { params }));
}
