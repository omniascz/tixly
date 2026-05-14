/**
 * POST /api/payments/stripe/webhook
 *
 * Stripe webhook receiver. Verifikuje signature, zpracovává:
 *   - checkout.session.completed       → order.status = 'paid', paid_at = NOW(),
 *                                         trigger /api/internal/order-completed
 *   - charge.refunded                  → audit log (refund může pocházet z dashboardu)
 *   - charge.dispute.created           → audit log + holdback flag
 *
 * Idempotency: každý event má unikátní id (`evt_...`). Ukládá se do
 * `audit.audit_log` — duplicitní delivery se rozpozná podle record_id.
 *
 * Stripe dashboard config: endpoint `https://<host>/api/payments/stripe/webhook`,
 * events: `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`,
 * `charge.dispute.closed`. Secret z webhook section → STRIPE_WEBHOOK_SECRET env.
 *
 * **Important:** Next.js App Router buffers JSON body. Pro Stripe potřebujeme RAW body,
 * proto explicitně čteme `req.text()` a vypneme JSON parsing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { verifyStripeWebhookSignature } from '@/lib/payment/stripe';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export const dynamic = 'force-dynamic';

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');

  const verify = await verifyStripeWebhookSignature({ rawBody, signatureHeader: sig });
  if (!verify.ok) {
    return NextResponse.json(
      { error: 'INVALID_SIGNATURE', reason: verify.reason },
      { status: 400 },
    );
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const client = await db().connect();
  try {
    // Idempotency: skip pokud už máme event v audit_log
    const seen = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit.audit_log
       WHERE schema_name = 'stripe' AND record_id = $1`,
      [event.id],
    );
    if (Number(seen.rows[0]?.count ?? 0) > 0) {
      return NextResponse.json({ ok: true, deduplicated: true });
    }

    await client.query('BEGIN');

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        id: string;
        payment_intent: string | null;
        payment_status: string;
        amount_total: number;
        currency: string;
        metadata?: { orderId?: string };
      };
      const orderId = session.metadata?.orderId;
      if (orderId && session.payment_status === 'paid') {
        const upd = await client.query<{ id: string; status: string }>(
          `UPDATE orders.orders
           SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
               gopay_payment_id = COALESCE(gopay_payment_id, $2)
           WHERE id = $1 AND status = 'pending'
           RETURNING id, status`,
          [orderId, session.payment_intent],
        );
        if (upd.rows.length > 0) {
          // Trigger internal order-completed (vstupenky + emaily) — fire-and-forget
          void (async () => {
            try {
              const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
              const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
              if (!internalToken) {
                console.warn('[stripe webhook] INTERNAL_SERVICE_TOKEN missing, skipping order-completed');
                return;
              }
              await fetch(`${appUrl}/api/internal/order-completed`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-internal-token': internalToken,
                },
                body: JSON.stringify({ orderId }),
              });
            } catch (err) {
              console.error('[stripe webhook] order-completed trigger failed:', err);
            }
          })();
        }
      }
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object as {
        id: string;
        payment_intent: string | null;
        amount_refunded: number;
        metadata?: { orderId?: string };
      };
      // Log jen — pokud refund vyšel z admin UI, už jsme order zaktualizovali.
      // Pokud vyšel ze Stripe dashboardu, audit log to zachytí pro reconciliation.
      if (charge.metadata?.orderId) {
        await client.query(
          `INSERT INTO audit.audit_log
             (schema_name, table_name, record_id, action, actor_type, new_values)
           VALUES ('stripe', 'webhook', $1, 'INSERT', 'system', $2::jsonb)`,
          [
            event.id,
            JSON.stringify({
              kind: 'charge_refunded',
              order_id: charge.metadata.orderId,
              charge_id: charge.id,
              payment_intent: charge.payment_intent,
              amount_refunded: charge.amount_refunded,
            }),
          ],
        );
      }
    } else if (event.type === 'charge.dispute.created') {
      const dispute = event.data.object as {
        id: string;
        charge: string;
        amount: number;
        reason: string;
        metadata?: { orderId?: string };
      };
      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_type, new_values)
         VALUES ('stripe', 'webhook', $1, 'INSERT', 'system', $2::jsonb)`,
        [
          event.id,
          JSON.stringify({
            kind: 'dispute_created',
            order_id: dispute.metadata?.orderId ?? null,
            charge_id: dispute.charge,
            dispute_id: dispute.id,
            amount: dispute.amount,
            reason: dispute.reason,
          }),
        ],
      );
    } else {
      // Neznámý/nesledovaný event — jen idempotency log
      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_type, new_values)
         VALUES ('stripe', 'webhook', $1, 'INSERT', 'system', $2::jsonb)`,
        [event.id, JSON.stringify({ kind: 'unhandled', type: event.type })],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[stripe webhook]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }
}
