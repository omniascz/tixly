/**
 * GET /api/internal/cron/recompute-dynamic-pricing
 *
 * Vercel cron 5min interval doporučeno. Pro každý ticket_type s
 * enabled dynamic pricing rule:
 *   1. computeDynamicPrice(ticketTypeId)
 *   2. UPDATE catalog.ticket_types.dynamic_price_minor + signals + timestamp
 *
 * Buyer při checkout dostane current price přes resolveCurrentPrice (existing).
 *
 * CZ priority #7 (FR/UK/IT audit, ROI 6/10). Recompute periodically =
 * promotér vidí current dynamic prices v admin dashboard real-time.
 *
 * Cap: 500 rules per run (chrání proti runaway).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from '@/lib/security/cron-auth';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { computeDynamicPrice } from '@/lib/dynamic-pricing/compute';

async function runRecompute(): Promise<Response> {
  // Cron = system op → platform admin kontext (connect() injektuje is_platform_admin).
  return runWithPlatformAdminContext(async () => {
  const client = await db().connect();
  let processed = 0;
  let updated = 0;
  let failed = 0;
  try {
    await client.query('BEGIN');

    const r = await client.query<{ ticket_type_id: string }>(
      `SELECT ticket_type_id
         FROM catalog.dynamic_pricing_rules
        WHERE enabled = true
        LIMIT 500`,
    );
    await client.query('COMMIT');

    for (const row of r.rows) {
      processed += 1;
      try {
        const result = await computeDynamicPrice(row.ticket_type_id);
        if (result.signals.enabled) {
          await db().query(
            `UPDATE catalog.ticket_types
                SET dynamic_price_minor = $2,
                    dynamic_price_signals = $3::jsonb,
                    dynamic_price_updated_at = NOW()
              WHERE id = $1`,
            [
              row.ticket_type_id,
              result.finalPriceMinor,
              JSON.stringify(result.signals),
            ],
          );
          updated += 1;
        }
      } catch (err) {
        console.error('[recompute-dynamic-pricing] tt', row.ticket_type_id, err);
        failed += 1;
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[recompute-dynamic-pricing]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({      // R-46: driv `ok: true` natvrdo, i kdyz `failed > 0`. Audit C2 sel po
      // jmennem seznamu devíti rout, takze tahle proklouzla (FINDINGS 174).
 ok: failed === 0, processed, updated, failed });
  });
}

// Vercel dispatcher POSTuje; manual test může GET.
export async function POST(req: NextRequest): Promise<Response> {
  // FIX K3a: bez autorizace mohl kdokoli spouštět cron (přepis cen / tokenů).
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  return runRecompute();
}
export async function GET(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  return runRecompute();
}
