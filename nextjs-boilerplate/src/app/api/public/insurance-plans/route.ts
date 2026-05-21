/**
 * GET /api/public/insurance-plans
 *
 * Vrátí dostupné insurance plány. Query: ?promoterId=<uuid> (volitelný custom plán)
 * V checkoutu se nabídnou jako checkbox volby.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoterId = new URL(req.url).searchParams.get('promoterId');

  let where = `WHERE is_active = true AND promoter_id IS NULL`;
  const args: unknown[] = [];
  if (promoterId) {
    args.push(promoterId);
    where = `WHERE is_active = true AND (promoter_id IS NULL OR promoter_id = $1)`;
  }

  const r = await db().query<{
    id: string;
    name: string;
    provider: string;
    description: string | null;
    price_pct: number | null;
    price_flat_halire: number | null;
    covers_illness: boolean;
    covers_cancellation: boolean;
    covers_transport_strike: boolean;
    covers_weather: boolean;
    coverage_url: string | null;
  }>(
    `SELECT id, name, provider, description, price_pct, price_flat_halire,
            covers_illness, covers_cancellation, covers_transport_strike,
            covers_weather, coverage_url
       FROM catalog.insurance_plans
       ${where}
   ORDER BY display_order, name`,
    args,
  );

  return NextResponse.json({ plans: r.rows });
}
