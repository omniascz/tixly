/**
 * POST /api/internal/cron/promoter-tier-evaluate
 *
 * Cron job — periodicky (1× denně) přehodnotí tier všech promotérů, kteří
 * nemají `tier_locked = TRUE`. Pokud se na základě objemu posledních 90 dní
 * kvalifikují na vyšší tier, upgrade je proveden a audit log zapsán.
 *
 * Auth: x-internal-token musí odpovídat INTERNAL_SERVICE_TOKEN.
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { evaluateTierUpgrade, type PromoterTier } from '@/lib/promoter/tier';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const r = await db().query<{
    id: string;
    name: string;
    tier: number;
    kyc_status: string;
    tickets_sold_90d: string;
  }>(
    `SELECT
       p.id, p.name, p.tier, COALESCE(p.kyc_status, 'pending') AS kyc_status,
       COALESCE(SUM(oi.quantity), 0)::text AS tickets_sold_90d
     FROM platform.promoters p
     LEFT JOIN catalog.events e ON e.promoter_id = p.id
     LEFT JOIN orders.orders o ON o.event_id = e.id
       AND o.status = 'paid' AND o.paid_at > NOW() - INTERVAL '90 days'
     LEFT JOIN orders.order_items oi ON oi.order_id = o.id
     WHERE p.status = 'active' AND p.tier_locked = FALSE
     GROUP BY p.id, p.name, p.tier, p.kyc_status`,
  );

  const results: Array<{
    promoterId: string;
    name: string;
    fromTier: number;
    toTier: number;
    reason: string;
    sold90d: number;
  }> = [];

  for (const row of r.rows) {
    const sold = Number(row.tickets_sold_90d);
    const evalResult = evaluateTierUpgrade({
      currentTier: row.tier as PromoterTier,
      ticketsSold90d: sold,
      kycVerified: row.kyc_status === 'verified',
      tierLocked: false,
    });

    if (evalResult.suggestedTier !== evalResult.currentTier) {
      await db().query(
        `UPDATE platform.promoters
         SET tier = $2, tier_updated_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [row.id, evalResult.suggestedTier],
      );
      await db().query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_type, new_values)
         VALUES ('platform', 'promoters', $1, 'UPDATE', 'system', $2::jsonb)`,
        [
          row.id,
          JSON.stringify({
            kind: 'tier_auto_upgrade',
            from_tier: row.tier,
            to_tier: evalResult.suggestedTier,
            reason: evalResult.reason,
            tickets_sold_90d: sold,
          }),
        ],
      );
      results.push({
        promoterId: row.id,
        name: row.name,
        fromTier: row.tier,
        toTier: evalResult.suggestedTier,
        reason: evalResult.reason,
        sold90d: sold,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    evaluated: r.rows.length,
    upgraded: results.length,
    upgrades: results,
  });
}
