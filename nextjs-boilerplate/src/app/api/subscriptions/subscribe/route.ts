/**
 * POST /api/subscriptions/subscribe
 *
 * GUEST-FRIENDLY endpoint pro tixly-plus marketing landing page.
 * Accepts { planId, buyerEmail (guest) | (token = authed) }.
 *
 * Pro již přihlášené buyery se preferuje `/api/buyer/subscriptions` POST
 * (strict-auth, vrací jejich existující sub pokud už existuje). Tento endpoint
 * akceptuje obojí, ale zákazníky bez účtu vytvoří jako anonymního usera —
 * což je pro guest checkout flow z tixly-plus landing OK.
 *
 * Demo mock: instant aktivace bez recurring billing flow.
 * V produkci by tu byl Stripe Subscription create + payment intent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  planId: z.string().uuid(),
  buyerEmail: z.string().email().optional(),
  buyerName: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  const headerUserId = req.headers.get('x-user-id');

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Resolve user
    let userId: string;
    if (headerUserId) {
      userId = headerUserId;
    } else if (input.buyerEmail) {
      const u = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
         VALUES ($1, $2, '!guest', NOW(), NOW(), NOW())
         ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE
           SET updated_at = NOW()
         RETURNING id`,
        [input.buyerEmail.toLowerCase(), input.buyerName ?? input.buyerEmail],
      );
      userId = u.rows[0]!.id;
    } else {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Auth required' }, { status: 401 });
    }

    // Validate plan
    const planRes = await client.query<{
      id: string;
      billing_cycle: string;
      active: boolean;
    }>(
      `SELECT id, billing_cycle, active FROM subscriptions.plans WHERE id = $1`,
      [input.planId],
    );
    if (planRes.rows.length === 0 || !planRes.rows[0]!.active) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'PLAN_NOT_AVAILABLE' }, { status: 422 });
    }
    const plan = planRes.rows[0]!;

    // Already active subscription pro tento plan?
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM subscriptions.subscriptions
       WHERE user_id = $1 AND plan_id = $2 AND status = 'active'`,
      [userId, plan.id],
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'ALREADY_SUBSCRIBED',
          subscriptionId: existing.rows[0]!.id,
        },
        { status: 409 },
      );
    }

    const periodEnd = new Date();
    if (plan.billing_cycle === 'monthly') {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    const sub = await client.query<{ id: string }>(
      `INSERT INTO subscriptions.subscriptions
         (user_id, plan_id, status, current_period_start, current_period_end, next_billing_at)
       VALUES ($1, $2, 'active', NOW(), $3, $3)
       RETURNING id`,
      [userId, plan.id, periodEnd.toISOString()],
    );
    await client.query('COMMIT');
    return NextResponse.json(
      {
        ok: true,
        subscriptionId: sub.rows[0]!.id,
        currentPeriodEnd: periodEnd.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[subscribe]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
