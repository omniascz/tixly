/**
 * POST /api/buyer/subscriptions/[id]/pick — Wahl-Abo event pick
 *
 * Buyer (holder owner) si vybere event z package pool-u. Vystaví ticket
 * + log redemption. Validuje:
 *   - holder.user_id == header x-user-id
 *   - holder.status == 'active' && payment_status == 'paid'
 *   - package.abo_type == 'choice'
 *   - event v package_events
 *   - žádná duplicate redemption (uq_subs_redemptions_holder_event)
 *   - počet redemptions < package.max_picks_for_choice
 *
 * GET /api/buyer/subscriptions/[id]/pick — vrátí stav: kolik pickovaných
 *   už je z max + seznam events v pool-u (s flagem alreadyPicked).
 *
 * DACH parity #P0-2 (Reservix Wahl-Abo pattern).
 */
import { randomBytes, randomUUID } from 'crypto';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import type { Pool } from 'pg';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { encryptSecret } from '@/lib/crypto';


const postSchema = z.object({
  eventId: z.string().uuid(),
});

interface HolderRow {
  id: string;
  user_id: string | null;
  holder_email: string;
  status: string;
  payment_status: string;
  package_id: string;
  abo_type: string;
  max_picks_for_choice: number | null;
}

interface HolderRowExt extends HolderRow {
  restwert_credit_halire: number;
  price_paid_halire: number;
}

async function loadHolder(
  client: { query: Pool['query'] },
  id: string,
  forUpdate: boolean,
): Promise<HolderRowExt | null> {
  const sql = `
    SELECT h.id, h.user_id, h.holder_email, h.status, h.payment_status,
           h.package_id, p.abo_type, p.max_picks_for_choice,
           h.restwert_credit_halire, h.price_paid_halire
      FROM subscriptions.holders h
      JOIN subscriptions.packages p ON p.id = h.package_id
     WHERE h.id = $1
     ${forUpdate ? 'FOR UPDATE OF h' : ''}`;
  const r = await client.query<HolderRowExt>(sql, [id]);
  return r.rows[0] ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const holder = await loadHolder(db() as unknown as Pool, params.id, false);
  if (!holder) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (holder.user_id !== userId) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  if (holder.abo_type !== 'choice') {
    return NextResponse.json(
      { error: 'NOT_CHOICE_ABO', message: 'Tento abonement není výběrový (Wahl-Abo).' },
      { status: 409 },
    );
  }

  const eventsRes = await db().query<{
    event_id: string;
    title: string;
    date_start: string;
    already_picked: boolean;
    ticket_id: string | null;
  }>(
    `SELECT pe.event_id, e.title, e.date_start::text,
            EXISTS(
              SELECT 1 FROM subscriptions.redemptions r
               WHERE r.holder_id = $1 AND r.event_id = pe.event_id
            ) AS already_picked,
            (SELECT r.ticket_id FROM subscriptions.redemptions r
              WHERE r.holder_id = $1 AND r.event_id = pe.event_id) AS ticket_id
       FROM subscriptions.package_events pe
       JOIN catalog.events e ON e.id = pe.event_id
      WHERE pe.package_id = $2 AND e.status IN ('published', 'pending_review')
      ORDER BY pe.order_index ASC, e.date_start ASC`,
    [params.id, holder.package_id],
  );

  const picksUsed = eventsRes.rows.filter((r) => r.already_picked).length;

  const picksRemaining = (holder.max_picks_for_choice ?? 0) - picksUsed;
  return NextResponse.json({
    holderId: holder.id,
    aboType: holder.abo_type,
    maxPicks: holder.max_picks_for_choice,
    picksUsed,
    picksRemaining,
    restwertCreditHalire: holder.restwert_credit_halire,
    pricePaidHalire: holder.price_paid_halire,
    events: eventsRes.rows.map((r) => ({
      eventId: r.event_id,
      title: r.title,
      dateStart: r.date_start,
      alreadyPicked: r.already_picked,
      ticketId: r.ticket_id,
    })),
  });

  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { eventId } = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: zbytek (balíček, pool akcí, výdej vstupenky) jsou systémové příkazy nad ověřenou abonentkou (asSystemInTx).

    // Kolo 3: vlastnictví abonentky pod kontextem kupce (RLS: holders.user_id = kupec).
    const ownRes = await client.query(
      `SELECT 1 FROM subscriptions.holders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [params.id, userId],
    );
    if (ownRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const holder = await asSystemInTx(client, () => loadHolder(client, params.id, true));
    if (!holder) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (holder.user_id !== userId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    if (holder.status !== 'active' || holder.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'HOLDER_NOT_ACTIVE', status: holder.status, paymentStatus: holder.payment_status },
        { status: 409 },
      );
    }
    if (holder.abo_type !== 'choice') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NOT_CHOICE_ABO', message: 'Tento abonement není výběrový.' },
        { status: 409 },
      );
    }

    // Event musí být v package_events
    const inPool = await asSystemInTx(client, () => client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM subscriptions.package_events
          WHERE package_id = $1 AND event_id = $2
       ) AS exists`,
      [holder.package_id, eventId],
    ));
    if (!inPool.rows[0].exists) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'EVENT_NOT_IN_PACKAGE', message: 'Tento event není v poolu abonementu.' },
        { status: 422 },
      );
    }

    // Picks count (lock holder řádek = bezpečné proti race)
    const usedRes = await asSystemInTx(client, () => client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM subscriptions.redemptions
        WHERE holder_id = $1`,
      [holder.id],
    ));
    const used = Number(usedRes.rows[0].count);
    if (used >= (holder.max_picks_for_choice ?? 0)) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'PICK_LIMIT_REACHED',
          message: `Limit ${holder.max_picks_for_choice} vyčerpán.`,
          maxPicks: holder.max_picks_for_choice,
          picksUsed: used,
        },
        { status: 409 },
      );
    }

    // Najdi cheapest ticket_type pro event
    const ttRes = await asSystemInTx(client, () => client.query<{ id: string }>(
      `SELECT id FROM catalog.ticket_types
        WHERE event_id = $1
        ORDER BY base_price ASC NULLS LAST
        LIMIT 1`,
      [eventId],
    ));
    if (ttRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NO_TICKET_TYPE', message: 'Event nemá nakonfigurovaný ticket_type.' },
        { status: 422 },
      );
    }
    const ticketTypeId = ttRes.rows[0].id;

    // Vystav ticket + log redemption
    const ticketId = randomUUID();
    const orderId = randomUUID();
    await asSystemInTx(client, () => client.query(
      `INSERT INTO orders.orders (id, user_id, event_id, status, total_amount, currency, expires_at, paid_at)
       VALUES ($1, $2, $3, 'paid', 0, 'CZK', NOW() + INTERVAL '30 days', NOW())
       ON CONFLICT DO NOTHING`,
      [orderId, holder.user_id, eventId],
    ));
    const totpSecretRaw = randomBytes(20);
    const totpEncryptedBundle = Buffer.from(
      encryptSecret(totpSecretRaw.toString('base64')),
      'base64',
    );
    await asSystemInTx(client, () => client.query(
      `INSERT INTO tickets.tickets
         (id, order_id, ticket_type_id, owner_id, original_owner_id, status,
          totp_secret_encrypted, totp_secret_iv, original_price)
       VALUES ($1, $2, $3, $4, $4, 'valid', $5, $6, 0)`,
      [ticketId, orderId, ticketTypeId, holder.user_id, totpEncryptedBundle, Buffer.alloc(0)],
    ));

    try {
      await asSystemInTx(client, () => client.query(
        `INSERT INTO subscriptions.redemptions
           (holder_id, event_id, ticket_id)
         VALUES ($1, $2, $3)`,
        [holder.id, eventId, ticketId],
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('uq_subs_redemptions_holder_event')) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'ALREADY_PICKED', message: 'Tento event už máš v abonementu.' },
          { status: 409 },
        );
      }
      throw err;
    }

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      ticketId,
      eventId,
      picksUsed: used + 1,
      maxPicks: holder.max_picks_for_choice,
      picksRemaining: (holder.max_picks_for_choice ?? 0) - (used + 1),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/buyer/subscriptions/.../pick]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
