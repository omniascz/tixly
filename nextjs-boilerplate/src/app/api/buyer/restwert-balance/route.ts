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
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const promoterId = req.nextUrl.searchParams.get('promoterId');

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: vlastní abonentky se zjistí pod kontextem kupce; souhrn přes balíčky (kupci nečitelné) je systémový dotaz omezený na ně.

    const own = await client.query<{ id: string }>(
      `SELECT id FROM subscriptions.holders WHERE user_id = $1`,
      [userId],
    );
    const holderIds = own.rows.map((r) => r.id);

    if (promoterId) {
      if (!/^[0-9a-f-]{36}$/i.test(promoterId)) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'BAD_PROMOTER_ID' }, { status: 422 });
      }
      const r = await asSystemInTx(client, () => client.query<{
        total: string;
        holders_count: string;
      }>(
        `SELECT COALESCE(SUM(h.restwert_credit_halire), 0)::text AS total,
                COUNT(*) FILTER (WHERE h.restwert_credit_halire > 0)::text AS holders_count
           FROM subscriptions.holders h
           JOIN subscriptions.packages p ON p.id = h.package_id
          WHERE h.user_id = $1
            AND p.promoter_id = $2
            AND h.status = 'active'
            AND h.id = ANY($3::uuid[])`,
        [userId, promoterId, holderIds],
      ));
      await client.query('COMMIT');
      return NextResponse.json({
        promoterId,
        balanceHalire: Number(r.rows[0].total),
        holdersWithCredit: Number(r.rows[0].holders_count),
      });
    }

    // Bez filtru: per-promoter breakdown
    const r = await asSystemInTx(client, () => client.query<{
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
          AND h.id = ANY($2::uuid[])
          AND h.status = 'active'
          AND h.restwert_credit_halire > 0
        GROUP BY p.promoter_id, pr.name
        ORDER BY total DESC NULLS LAST`,
      [userId, holderIds],
    ));

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

  });
}
