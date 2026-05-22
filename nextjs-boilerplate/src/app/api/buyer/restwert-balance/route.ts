/**
 * GET /api/buyer/restwert-balance?promoterId=X — vrátí celkový Restwert credit
 *
 * Buyer-side endpoint. Pro daného promotéra summarizuje zbytkové kredity
 * napříč všemi aktivními Wahl-Abo holdery. Použito v event checkout UI
 * pro tlačítko "Mám kredit X Kč u tohoto promotéra — uplatnit".
 *
 * Bez query param vrátí mapu { promoterId: balance } pro všechny.
 *
 * DACH P0-2 polish (Reservix Restwert UI flow).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const promoterId = req.nextUrl.searchParams.get('promoterId');

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    if (promoterId) {
      if (!/^[0-9a-f-]{36}$/i.test(promoterId)) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'BAD_PROMOTER_ID' }, { status: 422 });
      }
      const r = await client.query<{
        total: string;
        holders_count: string;
      }>(
        `SELECT COALESCE(SUM(h.restwert_credit_halire), 0)::text AS total,
                COUNT(*) FILTER (WHERE h.restwert_credit_halire > 0)::text AS holders_count
           FROM subscriptions.holders h
           JOIN subscriptions.packages p ON p.id = h.package_id
          WHERE h.user_id = $1
            AND p.promoter_id = $2
            AND h.status = 'active'`,
        [userId, promoterId],
      );
      await client.query('COMMIT');
      return NextResponse.json({
        promoterId,
        balanceHalire: Number(r.rows[0].total),
        holdersWithCredit: Number(r.rows[0].holders_count),
      });
    }

    // Bez filtru: per-promoter breakdown
    const r = await client.query<{
      promoter_id: string;
      promoter_name: string;
      total: string;
      holders_count: string;
    }>(
      `SELECT p.promoter_id, pr.name AS promoter_name,
              SUM(h.restwert_credit_halire)::text AS total,
              COUNT(*)::text AS holders_count
         FROM subscriptions.holders h
         JOIN subscriptions.packages p ON p.id = h.package_id
         JOIN platform.promoters pr ON pr.id = p.promoter_id
        WHERE h.user_id = $1
          AND h.status = 'active'
          AND h.restwert_credit_halire > 0
        GROUP BY p.promoter_id, pr.name
        ORDER BY total DESC NULLS LAST`,
      [userId],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      total: r.rows.length,
      promoters: r.rows.map((row) => ({
        promoterId: row.promoter_id,
        promoterName: row.promoter_name,
        balanceHalire: Number(row.total),
        holdersCount: Number(row.holders_count),
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET restwert-balance]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
