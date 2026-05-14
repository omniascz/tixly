/**
 * GET /api/buyer/loyalty
 *
 * Vrátí loyalty account: balance, lifetime, tier, posledních 20 transakcí,
 * tier progress (kolik bodů do dalšího tieru).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { TIER_THRESHOLDS } from '@/lib/loyalty/engine';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const acc = await db().query<{
    id: string;
    points_balance: number;
    lifetime_points: number;
    tier: string;
  }>(
    `SELECT id, points_balance, lifetime_points, tier
     FROM marketing.loyalty_accounts WHERE user_id = $1`,
    [userId],
  );

  if (acc.rows.length === 0) {
    return NextResponse.json({
      pointsBalance: 0,
      lifetimePoints: 0,
      tier: 'bronze',
      nextTier: 'silver',
      pointsToNextTier: TIER_THRESHOLDS.silver,
      transactions: [],
    });
  }
  const a = acc.rows[0]!;

  const tx = await db().query<{
    id: string;
    points_delta: number;
    kind: string;
    reason: string | null;
    order_id: string | null;
    created_at: string;
    expires_at: string | null;
  }>(
    `SELECT id, points_delta, kind, reason, order_id, created_at, expires_at
     FROM marketing.loyalty_transactions
     WHERE account_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [a.id],
  );

  const tier = a.tier as 'bronze' | 'silver' | 'gold';
  const nextTier =
    tier === 'bronze' ? 'silver' : tier === 'silver' ? 'gold' : null;
  const pointsToNextTier = nextTier
    ? TIER_THRESHOLDS[nextTier] - a.lifetime_points
    : 0;

  return NextResponse.json({
    pointsBalance: a.points_balance,
    lifetimePoints: a.lifetime_points,
    tier,
    nextTier,
    pointsToNextTier: Math.max(0, pointsToNextTier),
    transactions: tx.rows,
  });
}
