/**
 * POST /api/internal/cron/release-rolling-reserves
 *
 * Uvolňuje rolling reserves (chargeback holdback), kterým vypršela retention.
 * Spouštět denně přes Vercel cron.
 *
 * Logika:
 *   1. SELECT všechny rolling_reserves kde released=FALSE a release_date <= TODAY
 *   2. Marknout released=TRUE + released_at=NOW()
 *   3. Audit log (kolik uvolněno, pro koho)
 *
 * Bezpečnost: x-internal-token header musí odpovídat INTERNAL_SERVICE_TOKEN.
 */

import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';


function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = await db().connect();
  let releasedCount = 0;
  let totalAmount = 0;
  const byPromoter: Record<string, number> = {};

  try {
    await client.query('BEGIN');

    const r = await client.query<{
      id: string;
      promoter_id: string;
      amount: number;
    }>(
      `UPDATE platform.rolling_reserves
       SET released = TRUE, released_at = NOW()
       WHERE released = FALSE AND release_date <= CURRENT_DATE
       RETURNING id, promoter_id, amount`,
    );

    releasedCount = r.rows.length;
    for (const row of r.rows) {
      totalAmount += row.amount;
      byPromoter[row.promoter_id] = (byPromoter[row.promoter_id] ?? 0) + row.amount;
    }

    if (releasedCount > 0) {
      await client.query(
        // D4: puvodne action='BULK_RELEASE', actor_type='cron' — ANI JEDNO neni
        // v prislusnem CHECK vyctu (action: INSERT/UPDATE/DELETE; actor_type:
        // user/system/admin/platform_admin/gate/promoter). INSERT byl PRITOM
        // VE STEJNE TRANSAKCI jako UPDATE rezerv, takze 23514 rollbacknul
        // i UVOLNENI SAMOTNE — promoterum se zadrzovaly penize a nikdo to
        // nevidel, protoze routa vratila 500 az z catch bloku (FINDINGS §142).
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_type, new_values)
         VALUES ('platform', 'rolling_reserves', $1, 'UPDATE', 'system', $2::jsonb)`,
        [
          // Použijeme první reserve id jako anchor pro batch
          r.rows[0].id,
          JSON.stringify({
            // 'BULK_RELEASE' nese DETAIL, ne sloupec action — ten ma CHECK
            // ARRAY['INSERT','UPDATE','DELETE'] a enum se nerozsiruje (D4).
            operation: 'BULK_RELEASE',
            releasedCount,
            totalAmount,
            byPromoter,
          }),
        ],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // Kontrakt C2: cron nevraci 500, ale ok:false s duvodem — jinak se selhani
    // ztrati v retry smycce planovace misto aby bylo videt v monitoringu.
    return NextResponse.json({
      ok: false, processed: 0, failed: 1,
      errors: [`release: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`],
    });
  } finally {
    client.release();
  }

  return NextResponse.json({
    ok: true,
    processed: releasedCount,
    failed: 0,
    errors: [],
    releasedCount,
    totalAmount,
    byPromoter,
  });

  });
}
