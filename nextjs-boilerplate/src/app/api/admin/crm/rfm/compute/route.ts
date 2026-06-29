import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

interface BuyerRow {
  user_id: string;
  email: string;
  name: string | null;
  recency_days: number;
  frequency: number;
  monetary_halire: string;
}

function rScore(recencyDays: number): number {
  if (recencyDays <= 7) return 5;
  if (recencyDays <= 30) return 4;
  if (recencyDays <= 90) return 3;
  if (recencyDays <= 180) return 2;
  return 1;
}

function fScore(frequency: number): number {
  if (frequency >= 10) return 5;
  if (frequency >= 5) return 4;
  if (frequency >= 3) return 3;
  if (frequency >= 2) return 2;
  return 1;
}

function mScore(monetary: bigint, quintiles: bigint[]): number {
  if (monetary >= quintiles[3]) return 5;
  if (monetary >= quintiles[2]) return 4;
  if (monetary >= quintiles[1]) return 3;
  if (monetary >= quintiles[0]) return 2;
  return 1;
}

function segment(rfmTotal: number): 'A' | 'B' | 'C' | 'D' {
  if (rfmTotal >= 12) return 'A';
  if (rfmTotal >= 9) return 'B';
  if (rfmTotal >= 6) return 'C';
  return 'D';
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const buyers = await db().query<BuyerRow>(
      `SELECT u.id AS user_id, u.email, u.name,
              EXTRACT(DAY FROM NOW() - MAX(o.created_at))::int AS recency_days,
              COUNT(DISTINCT o.id)::int AS frequency,
              SUM(o.total_amount)::bigint AS monetary_halire
         FROM orders.orders o
         JOIN identity.users u ON u.id = o.user_id
         JOIN orders.order_items oi ON oi.order_id = o.id
         JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
         JOIN catalog.events e ON e.id = tt.event_id
        WHERE e.promoter_id = $1 AND o.status = 'paid'
        GROUP BY u.id, u.email, u.name`,
      [promoter.promoterId],
    );

    if (buyers.rows.length === 0) {
      return NextResponse.json({ computed: 0, segments: { A: 0, B: 0, C: 0, D: 0 } });
    }

    const monetaryValues = buyers.rows.map((r) => BigInt(r.monetary_halire)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const n = monetaryValues.length;
    const quintiles: bigint[] = [
      monetaryValues[Math.floor(n * 0.2)] ?? 0n,
      monetaryValues[Math.floor(n * 0.4)] ?? 0n,
      monetaryValues[Math.floor(n * 0.6)] ?? 0n,
      monetaryValues[Math.floor(n * 0.8)] ?? 0n,
    ];

    const counts = { A: 0, B: 0, C: 0, D: 0 };

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      for (const row of buyers.rows) {
        const r = rScore(row.recency_days);
        const f = fScore(row.frequency);
        const m = mScore(BigInt(row.monetary_halire), quintiles);
        const seg = segment(r + f + m);
        counts[seg]++;
        await client.query(
          `INSERT INTO marketing.rfm_scores
             (promoter_id, user_id, email, name, recency_days, frequency, monetary_halire,
              r_score, f_score, m_score, segment, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
           ON CONFLICT (promoter_id, user_id) DO UPDATE SET
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             recency_days = EXCLUDED.recency_days,
             frequency = EXCLUDED.frequency,
             monetary_halire = EXCLUDED.monetary_halire,
             r_score = EXCLUDED.r_score,
             f_score = EXCLUDED.f_score,
             m_score = EXCLUDED.m_score,
             segment = EXCLUDED.segment,
             computed_at = now()`,
          [
            promoter.promoterId,
            row.user_id,
            row.email,
            row.name,
            row.recency_days,
            row.frequency,
            row.monetary_halire,
            r,
            f,
            m,
            seg,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    return NextResponse.json({ computed: buyers.rows.length, segments: counts });
  });
}
