/**
 * GET  /api/admin/events/[id]/fan-bonus  — nastavení + statistika FanBonus
 * PATCH /api/admin/events/[id]/fan-bonus  — zapnout/vypnout, nastavit pct
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const [settingsR, statsR] = await Promise.all([
      runWithServiceContext(() =>
        db().query(
          `SELECT fan_bonus_enabled, fan_bonus_pct
           FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`,
          [params.id, ctx.promoterId],
        ),
      ),
      runWithServiceContext(() =>
        db().query(
          `SELECT
             COUNT(*)::int                                        AS total_issued,
             COALESCE(SUM(fbi.earned_halire),0)::int             AS total_earned_halire,
             COUNT(*) FILTER (WHERE gv.balance_halire > 0)::int  AS active_count,
             COALESCE(SUM(fbi.earned_halire - gv.balance_halire) FILTER
               (WHERE gv.balance_halire < fbi.earned_halire),0)::int AS total_redeemed_halire
           FROM marketing.fan_bonus_issued fbi
           JOIN marketing.gift_vouchers gv ON gv.id = fbi.voucher_id
           WHERE fbi.event_id = $1`,
          [params.id],
        ),
      ),
    ]);

    if (settingsR.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      settings: settingsR.rows[0],
      stats: statsR.rows[0] ?? {},
    });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const b = await req.json() as {
      fan_bonus_enabled?: boolean;
      fan_bonus_pct?: number;
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (b.fan_bonus_enabled !== undefined) {
      fields.push(`fan_bonus_enabled=$${i++}`);
      values.push(b.fan_bonus_enabled);
    }
    if (b.fan_bonus_pct !== undefined) {
      if (b.fan_bonus_pct < 0 || b.fan_bonus_pct > 10) {
        return NextResponse.json({ error: 'fan_bonus_pct musí být 0–10' }, { status: 400 });
      }
      fields.push(`fan_bonus_pct=$${i++}`);
      values.push(b.fan_bonus_pct);
    }

    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    values.push(params.id, ctx.promoterId);
    const r = await runWithServiceContext(() =>
      db().query(
        `UPDATE catalog.events SET ${fields.join(',')}
         WHERE id=$${i} AND promoter_id=$${i + 1}
         RETURNING fan_bonus_enabled, fan_bonus_pct`,
        values,
      ),
    );

    if (r.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ settings: r.rows[0] });
  });
}
