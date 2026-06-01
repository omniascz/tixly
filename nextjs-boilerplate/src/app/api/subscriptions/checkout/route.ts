/**
 * POST /api/subscriptions/checkout — buyer purchase abonentky
 *
 * Body: {
 *   packageId, buyerEmail, buyerName, buyerPhone?,
 *   preferredSeatId? (pokud venue má seating chart),
 *   preferredZone?  (free-text zóna pro venue bez seating)
 * }
 *
 * Flow:
 *   1) Validace package (status = 'on_sale', sale_start <= NOW(), capacity)
 *   2) Resolve effective price (early-bird vs base)
 *   3) Vytvoř/najdi guest user-a (pokud x-user-id chybí)
 *   4) Transakcí: INSERT holder, mock payment session
 *   5) Vrať gatewayUrl
 *
 * Auth: optional (x-user-id pokud přihlášen, jinak guest podle email).
 *
 * M2 doplnit:
 *   - Webhook po payment success → activate holder
 *   - Auto-issue tickets pro events v package_events
 *   - Seat lock v rámci package (uq constraint preferred_seat_id)
 */
import { randomUUID } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';


const schema = z.object({
  packageId: z.string().uuid(),
  buyerEmail: z.string().email(),
  buyerName: z.string().min(1).max(120),
  buyerPhone: z.string().max(30).optional(),
  preferredSeatId: z.string().uuid().optional(),
  preferredZone: z.string().max(50).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const d = parsed.data;
  const headerUserId = req.headers.get('x-user-id') ?? null;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // 1. Načti package + lock (capacity check)
    const pkgRes = await client.query<{
      id: string;
      promoter_id: string;
      name: string;
      season_label: string;
      sale_start: string;
      sale_end: string | null;
      capacity: number | null;
      base_price_halire: number;
      early_bird_until: string | null;
      early_bird_price_halire: number | null;
      currency: string;
      status: string;
    }>(
      `SELECT id, promoter_id, name, season_label, sale_start::text, sale_end::text,
              capacity, base_price_halire,
              early_bird_until::text, early_bird_price_halire, currency, status
         FROM subscriptions.packages
        WHERE id = $1
        FOR UPDATE`,
      [d.packageId],
    );
    if (pkgRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'PACKAGE_NOT_FOUND' }, { status: 404 });
    }
    const pkg = pkgRes.rows[0];

    if (pkg.status !== 'on_sale') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_ON_SALE', status: pkg.status }, { status: 409 });
    }
    const now = new Date();
    if (new Date(pkg.sale_start) > now) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'SALE_NOT_STARTED' }, { status: 409 });
    }
    if (pkg.sale_end && new Date(pkg.sale_end) < now) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'SALE_ENDED' }, { status: 409 });
    }

    // Capacity check
    if (pkg.capacity !== null) {
      const sold = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM subscriptions.holders
          WHERE package_id = $1 AND status IN ('active', 'suspended')`,
        [pkg.id],
      );
      if (Number(sold.rows[0].count) >= pkg.capacity) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'SOLD_OUT' }, { status: 409 });
      }
    }

    // 2. Effective price (early-bird vs base)
    const earlyBirdActive =
      pkg.early_bird_until !== null &&
      pkg.early_bird_price_halire !== null &&
      new Date(pkg.early_bird_until) > now;
    const pricePaid = earlyBirdActive ? pkg.early_bird_price_halire! : pkg.base_price_halire;

    // 3. Resolve user
    let userId = headerUserId;
    if (!userId) {
      // Guest signup — vytvoř/najdi podle email
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, phone, password_hash)
         VALUES ($1, $2, $3, '!guest')
         ON CONFLICT (email)
           DO UPDATE SET name = COALESCE(EXCLUDED.name, identity.users.name),
                         phone = COALESCE(EXCLUDED.phone, identity.users.phone)
         RETURNING id`,
        [d.buyerEmail.toLowerCase(), d.buyerName, d.buyerPhone ?? null],
      );
      userId = userRes.rows[0].id;
    }

    // 4. Valid until — konec sezóny (heuristika: 12 měsíců od sale_start)
    const validUntil = new Date(pkg.sale_start);
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    // 5. INSERT holder se status='pending_payment' (aktivace po confirm-payment)
    const paymentId = randomUUID();
    let holderId: string;
    try {
      const h = await client.query<{ id: string }>(
        `INSERT INTO subscriptions.holders
           (package_id, user_id, holder_name, holder_email, holder_phone,
            preferred_seat_id, preferred_zone, status,
            payment_status, payment_id, payment_provider,
            valid_from, valid_until, price_paid_halire, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_payment',
                 'pending', $8, 'mock',
                 NOW(), $9::timestamptz, $10, $11)
         RETURNING id`,
        [
          pkg.id,
          userId,
          d.buyerName,
          d.buyerEmail.toLowerCase(),
          d.buyerPhone ?? null,
          d.preferredSeatId ?? null,
          d.preferredZone ?? null,
          paymentId,
          validUntil.toISOString(),
          pricePaid,
          pkg.currency,
        ],
      );
      holderId = h.rows[0].id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('uq_subs_holders_seat')) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'SEAT_TAKEN' }, { status: 409 });
      }
      throw err;
    }

    // 6. Mock payment session
    const gatewayUrl = `/mock-subscription/${paymentId}`;

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      holderId,
      pricePaidHalire: pricePaid,
      currency: pkg.currency,
      gatewayUrl,
      paymentId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/subscriptions/checkout]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
