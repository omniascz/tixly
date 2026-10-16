/**
 * POST /api/subscriptions/holders/[paymentId]/confirm — payment confirmation
 *
 * Body: { action: 'pay' | 'cancel' }
 *
 * Flow PAY:
 *   1. SELECT holder + package + events (FOR UPDATE)
 *   2. UPDATE holder.status='active', payment_status='paid', paid_at=NOW()
 *   3. Auto-issue tickets pro každý event v package_events
 *   4. Log redemption row pro každý event (status='reserved')
 *
 * Flow CANCEL:
 *   - UPDATE holder.status='cancelled', payment_status='cancelled'
 *
 * Idempotency: pokud už paid, vrátí current state.
 *
 * Auth: žádný — payment_id je shared secret z mock-gopay flow.
 */
import { randomBytes, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { encryptSecret } from '@/lib/crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { launchFeatureNotFound } from '@/lib/features/launch-flags';
import { demoPathDisabledResponse } from '@/lib/payment/demo-path-guard';


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  // Kolo 10: vypnuto přepínačem (výchozí stav) → 404.
  const featureOff = launchFeatureNotFound('subscriptions');
  if (featureOff) return featureOff;
  // FIX K1: „subscription mock confirm" aktivoval předplatné a vystavil vstupenky
  // BEZ platby a BEZ auth (payment_id = shared secret). Vypnuto do napojení na
  // platební tok (FIX_REPORT_K.md).
  const disabled = demoPathDisabledResponse();
  if (disabled) return disabled;
  return runWithServiceContext(async () => {

  const { paymentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) {
    return NextResponse.json({ error: 'INVALID_PAYMENT_ID' }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: 'pay' | 'cancel' };
  const action = body.action ?? 'pay';

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: servisní kontext (runWithServiceContext) stačí — politiky mají větev app_is_service(); admin eskalace odstraněna.

    const holderRes = await client.query<{
      id: string;
      package_id: string;
      user_id: string | null;
      holder_email: string;
      status: string;
      payment_status: string;
      abo_type: string;
      max_picks_for_choice: number | null;
    }>(
      `SELECT h.id, h.package_id, h.user_id, h.holder_email, h.status, h.payment_status,
              p.abo_type, p.max_picks_for_choice
         FROM subscriptions.holders h
         JOIN subscriptions.packages p ON p.id = h.package_id
        WHERE h.payment_id = $1
        FOR UPDATE`,
      [paymentId],
    );

    if (holderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'PAYMENT_NOT_FOUND' }, { status: 404 });
    }
    const holder = holderRes.rows[0];

    // Idempotency
    if (holder.payment_status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json({
        holderId: holder.id,
        status: holder.status,
        paymentStatus: holder.payment_status,
        message: 'Already processed',
      });
    }

    if (action === 'cancel') {
      await client.query(
        `UPDATE subscriptions.holders
            SET status = 'cancelled',
                payment_status = 'cancelled',
                cancelled_at = NOW(),
                cancellation_reason = 'Payment cancelled by buyer'
          WHERE id = $1`,
        [holder.id],
      );
      await client.query('COMMIT');
      return NextResponse.json({
        holderId: holder.id,
        status: 'cancelled',
        paymentStatus: 'cancelled',
      });
    }

    // PAY → aktivovat
    await client.query(
      `UPDATE subscriptions.holders
          SET status = 'active',
              payment_status = 'paid',
              paid_at = NOW()
        WHERE id = $1`,
      [holder.id],
    );

    // Choice abo: NEauto-issue, buyer si vybere ručně přes /pick endpoint
    if (holder.abo_type === 'choice') {
      // Vrátíme total events v pool-u + max_picks pro klienta
      const pool = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM subscriptions.package_events
          WHERE package_id = $1`,
        [holder.package_id],
      );
      await client.query('COMMIT');
      return NextResponse.json({
        holderId: holder.id,
        status: 'active',
        paymentStatus: 'paid',
        aboType: 'choice',
        maxPicks: holder.max_picks_for_choice,
        eventsInPool: Number(pool.rows[0].total),
        ticketsIssued: 0,
      });
    }

    // Fixed abo: auto-issue ticket per event v package_events
    const eventsRes = await client.query<{
      event_id: string;
      ticket_type_id: string | null;
    }>(
      `SELECT pe.event_id,
              (SELECT tt.id FROM catalog.ticket_types tt
                WHERE tt.event_id = pe.event_id
                ORDER BY tt.base_price ASC NULLS LAST
                LIMIT 1) AS ticket_type_id
         FROM subscriptions.package_events pe
         JOIN catalog.events e ON e.id = pe.event_id
        WHERE pe.package_id = $1 AND e.status IN ('published', 'pending_review')
        ORDER BY pe.order_index ASC`,
      [holder.package_id],
    );

    let issued = 0;
    for (const ev of eventsRes.rows) {
      if (!ev.ticket_type_id) continue;
      const ticketId = randomUUID();
      const orderId = randomUUID();
      try {
        // Minimal order shell (subscription tickets nemají separate payment)
        await client.query(
          `INSERT INTO orders.orders (id, user_id, event_id, status, total_amount, currency, expires_at, paid_at)
           VALUES ($1, $2, $3, 'paid', 0, 'CZK', NOW() + INTERVAL '30 days', NOW())
           ON CONFLICT DO NOTHING`,
          [orderId, holder.user_id, ev.event_id],
        );
        const totpRaw = randomBytes(20);
        const totpBundle = Buffer.from(
          encryptSecret(totpRaw.toString('base64')),
          'base64',
        );
        await client.query(
          `INSERT INTO tickets.tickets
             (id, order_id, ticket_type_id, owner_id, original_owner_id, status,
              totp_secret_encrypted, totp_secret_iv, original_price)
           VALUES ($1, $2, $3, $4, $4, 'valid', $5, $6, 0)
           ON CONFLICT DO NOTHING`,
          [ticketId, orderId, ev.ticket_type_id, holder.user_id, totpBundle, Buffer.alloc(0)],
        );
        // Log redemption (issued, ne yet redeemed)
        await client.query(
          `INSERT INTO subscriptions.redemptions
             (holder_id, event_id, ticket_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (holder_id, event_id) DO NOTHING`,
          [holder.id, ev.event_id, ticketId],
        );
        issued += 1;
      } catch (err) {
        // Neblokuj activation pokud konkrétní ticket nelze vystavit (logged)
        console.error('[subs confirm] issue ticket failed:', ev.event_id, err);
      }
    }

    await client.query('COMMIT');

    return NextResponse.json({
      holderId: holder.id,
      status: 'active',
      paymentStatus: 'paid',
      aboType: 'fixed',
      ticketsIssued: issued,
      totalEvents: eventsRes.rows.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/subscriptions/holders/.../confirm]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
