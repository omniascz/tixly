/**
 * GET /api/admin/pricing-elasticity
 *
 * Pricemaster — vrátí pozorovanou elasticitu z catalog.vw_price_elasticity
 * pro všechny ticket_types promotéra. Použito v Pricemaster dashboardu.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const r = await db().query<{
    ticket_type_id: string;
    ticket_type_name: string;
    event_title: string;
    event_id: string;
    avg_elasticity: number | null;
    sample_count: string;
    total_price_changes: string;
    base_price: number;
  }>(
    `SELECT
        tt.id AS ticket_type_id,
        tt.name AS ticket_type_name,
        e.title AS event_title,
        e.id AS event_id,
        tt.base_price,
        ROUND(AVG(NULLIF(el.observed_elasticity, 0))::numeric, 3) AS avg_elasticity,
        COUNT(el.observed_elasticity)::text AS sample_count,
        (SELECT COUNT(*)::text FROM catalog.ticket_type_price_history WHERE ticket_type_id = tt.id) AS total_price_changes
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
  LEFT JOIN catalog.vw_price_elasticity el ON el.ticket_type_id = tt.id
      WHERE e.promoter_id = $1
        AND e.date_start > now() - INTERVAL '90 days'
   GROUP BY tt.id, tt.name, e.title, e.id, tt.base_price
   ORDER BY e.date_start DESC, tt.name
      LIMIT 200`,
    [promoter.promoterId],
  );

  // Per-promoter summary
  const validElasticities = r.rows
    .map((row) => row.avg_elasticity)
    .filter((e): e is number => e !== null);
  const meanElasticity = validElasticities.length > 0
    ? validElasticities.reduce((s, e) => s + Number(e), 0) / validElasticities.length
    : null;

  return NextResponse.json({
    ticketTypes: r.rows.map((row) => ({
      ...row,
      sample_count: Number(row.sample_count),
      total_price_changes: Number(row.total_price_changes),
    })),
    summary: {
      meanElasticity: meanElasticity !== null ? Number(meanElasticity.toFixed(3)) : null,
      sampleSize: validElasticities.length,
      interpretation: meanElasticity === null
        ? 'Nedostatek dat (chce to alespoň 1 cenovou změnu s prodeji)'
        : meanElasticity < -1
        ? 'Elastický trh — zákazníci citliví na cenu, snížení může zvýšit revenue'
        : meanElasticity < 0
        ? 'Mírně elastický — opatrné cenové změny optimální'
        : 'Inelastický nebo data anomálie — over-pricing možný',
    },
  });
}
