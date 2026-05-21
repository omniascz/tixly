/**
 * POST /api/buyer/resale/list
 *
 * Body: { ticketId: string, askPriceHalire: number }
 *
 * Demo resale listing:
 *   1. Auth: JWT user (přes middleware → x-user-id)
 *   2. Validuje ownership (ticket.owner_id == userId)
 *   3. Validuje status = 'valid' (ne used/revoked)
 *   4. EU 110 % price cap (Directive 2019/771): askPrice ≤ original_price × 1.10
 *   5. Vytvoří resale.resale_listings status='active', expires_at = +14d
 *   6. Idempotent: existující active listing → 409
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { checkResaleEligibility } from '@/lib/resale/reissue';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// DB constraint resale_listings.chk_resale_face_value_enforcement vynucuje
// ask_price <= original_price (žádný markup). To je nejstriktnější výklad EU
// pravidel proti scalping. Pokud chcete povolit 110 %, upravte i DB constraint.
const PRICE_CAP_BPS = 10000; // 100.00 % — face value cap

const schema = z.object({
  ticketId: z.string().regex(/^[0-9a-f-]{36}$/i),
  askPriceHalire: z.number().int().min(1),
  // Demo: pro guest kupce, kteří lístek vlastní pod e-mailem (žádný JWT).
  // V produkci tohle musí být JWT-only.
  ownerEmail: z.string().email().optional(),
});

interface TicketRow {
  id: string;
  status: string;
  owner_id: string;
  original_price: number;
}

interface ExistingListing {
  id: string;
}

/**
 * GET /api/buyer/resale/list?ticketId=… — zjistí, zda už existuje aktivní listing.
 * Nevyžaduje auth (read-only); slouží UI k podmíněnému zobrazení tlačítka.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const ticketId = new URL(req.url).searchParams.get('ticketId');
  if (!ticketId || !/^[0-9a-f-]{36}$/i.test(ticketId)) {
    return NextResponse.json({ active: null });
  }
  const r = await db().query<{ id: string; ask_price: number; status: string }>(
    `SELECT id, ask_price, status FROM resale.resale_listings
     WHERE ticket_id = $1 AND status = 'active'
     LIMIT 1`,
    [ticketId],
  );
  if (r.rows.length === 0) return NextResponse.json({ active: null });
  return NextResponse.json({
    active: { listingId: r.rows[0].id, askPriceHalire: r.rows[0].ask_price },
  });
}

function humanResaleReason(reason: string): string {
  switch (reason) {
    case 'event_resale_disabled': return 'Pořadatel resale neumožňuje.';
    case 'ticket_type_not_resellable': return 'Tento typ vstupenky nelze přeprodat.';
    case 'combo_excluded': return 'Balíčkové vstupenky nelze přeprodat (vyloučeno politikou).';
    case 'ticket_not_valid': return 'Lístek není v platném stavu.';
    case 'past_deadline': return 'Deadline pro resale už uplynul.';
    case 'ticket_not_found': return 'Lístek nenalezen.';
    default: return 'Lístek nelze přeprodat.';
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const headerUserId = req.headers.get('x-user-id');

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { ticketId, askPriceHalire, ownerEmail } = parsed.data;

  // Resolve userId: header (JWT) → ownerEmail (guest demo)
  let userId: string;
  if (headerUserId) {
    userId = headerUserId;
  } else if (ownerEmail) {
    const u = await db().query<{ id: string }>(
      `SELECT id FROM identity.users WHERE email = $1 AND anonymized_at IS NULL LIMIT 1`,
      [ownerEmail.toLowerCase()],
    );
    if (u.rows.length === 0) {
      return NextResponse.json({ error: 'Owner email not found' }, { status: 404 });
    }
    userId = u.rows[0].id;
  } else {
    return NextResponse.json({ error: 'Auth required (JWT or ownerEmail)' }, { status: 401 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const t = await client.query<TicketRow>(
      `SELECT id, status, owner_id, original_price
       FROM tickets.tickets
       WHERE id = $1
       FOR UPDATE`,
      [ticketId],
    );
    if (t.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    const ticket = t.rows[0];
    if (ticket.owner_id !== userId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not the ticket owner' }, { status: 403 });
    }

    // Eventim-style eligibility (policy + deadline + combo + status)
    const eligibility = await checkResaleEligibility(ticketId);
    if (!eligibility.eligible) {
      await client.query('ROLLBACK');
      return NextResponse.json({
        error: 'RESALE_NOT_ELIGIBLE',
        reason: eligibility.reason,
        resaleDeadline: eligibility.resaleDeadline,
        message: humanResaleReason(eligibility.reason),
      }, { status: 409 });
    }

    // EU price cap
    const maxAllowed = Math.floor((ticket.original_price * PRICE_CAP_BPS) / 10000);
    if (askPriceHalire > maxAllowed) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'PRICE_CAP_EXCEEDED',
          message: `Maximální resale cena je face value (${maxAllowed} haléřů).`,
          maxHalire: maxAllowed,
          originalHalire: ticket.original_price,
        },
        { status: 422 },
      );
    }

    // Idempotent active listing check
    const existing = await client.query<ExistingListing>(
      `SELECT id FROM resale.resale_listings
       WHERE ticket_id = $1 AND status = 'active'
       LIMIT 1`,
      [ticketId],
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'ALREADY_LISTED', listingId: existing.rows[0].id },
        { status: 409 },
      );
    }

    const ins = await client.query<{ id: string }>(
      `INSERT INTO resale.resale_listings
         (ticket_id, seller_id, ask_price, original_price,
          status, escrow_status, listed_at, expires_at)
       VALUES ($1, $2, $3, $4, 'active', 'none', NOW(), NOW() + INTERVAL '14 days')
       RETURNING id`,
      [ticketId, userId, askPriceHalire, ticket.original_price],
    );

    await client.query('COMMIT');
    return NextResponse.json(
      {
        listingId: ins.rows[0].id,
        ticketId,
        askPriceHalire,
        maxAllowedHalire: maxAllowed,
      },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/buyer/resale/list]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
