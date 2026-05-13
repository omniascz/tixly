/**
 * POST /api/buyer/subscriptions/[id]/refund-prorata
 *
 * Immediate cancel + prorata refund podle nespotřebovaných lístků.
 * Vrácená částka = price × (allowance - consumed) / allowance, zaokrouhleno dolů.
 *
 * Předpoklady:
 *  1. Buyer je vlastník subscription
 *  2. Subscription status = 'active'
 *  3. Promotér nastavil `allow_customer_self_refund = true` (refund_policies)
 *  4. Pokud allowance - consumed == 0, refund = 0 (jen cancel, žádné peníze zpět)
 *
 * Bez platební brány: jen state machine + audit log (nikde se peníze fyzicky
 * nepřevedou, ale v reportu pro účetní bude refund_amount viditelný).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // 1) Načti subscription + plan + promoter policy
    const subRes = await client.query<{
      id: string;
      status: string;
      plan_id: string;
      price_halire: number;
      allowance: number;
      current_period_start: string;
      promoter_id: string;
      allow_self: boolean;
      consumed: string;
    }>(
      `SELECT s.id, s.status, s.plan_id, s.current_period_start,
              p.price_halire, p.allowance_per_period AS allowance, p.promoter_id,
              COALESCE(rp.allow_customer_self_refund, false) AS allow_self,
              (SELECT COUNT(*)::text FROM subscriptions.consumptions c
               WHERE c.subscription_id = s.id
                 AND c.period_start = s.current_period_start) AS consumed
       FROM subscriptions.subscriptions s
       JOIN subscriptions.plans p ON p.id = s.plan_id
       LEFT JOIN platform.refund_policies rp ON rp.promoter_id = p.promoter_id
       WHERE s.id = $1 AND s.user_id = $2
       FOR UPDATE OF s`,
      [params.id, userId],
    );
    const sub = subRes.rows[0];
    if (!sub) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (sub.status !== 'active') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NOT_ACTIVE', currentStatus: sub.status },
        { status: 409 },
      );
    }
    if (!sub.allow_self) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'SELF_REFUND_DISABLED',
          message: 'Tento pořadatel nepovoluje self-service refund permanentek. Kontaktuj ho přímo.',
        },
        { status: 403 },
      );
    }

    // 2) Spočti prorata
    const consumed = Number(sub.consumed);
    const remaining = sub.allowance - consumed;
    const refundHalire = remaining > 0
      ? Math.floor((sub.price_halire * remaining) / sub.allowance)
      : 0;

    // 3) Cancel subscription immediately
    await client.query(
      `UPDATE subscriptions.subscriptions
         SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1`,
      [params.id],
    );

    // 4) Audit log s refund částkou
    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('subscriptions', 'subscriptions', $1, 'UPDATE', $2, 'user', $3::jsonb)`,
      [
        params.id,
        userId,
        JSON.stringify({
          kind: 'prorata_refund',
          consumed,
          remaining,
          allowance: sub.allowance,
          price_halire: sub.price_halire,
          refund_halire: refundHalire,
        }),
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      refundHalire,
      consumed,
      remaining,
      allowance: sub.allowance,
      note: refundHalire === 0
        ? 'Permanentka byla vyčerpaná, žádné prorata.'
        : `Vráceno ${(refundHalire / 100).toLocaleString('cs-CZ')} Kč za nespotřebovaných ${remaining} lístků z ${sub.allowance}.`,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
