import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

interface RfmRow {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  recency_days: number;
  frequency: number;
  monetary_halire: string;
  r_score: number;
  f_score: number;
  m_score: number;
  rfm_total: number;
  segment: string;
  computed_at: string;
}

interface AggRow {
  seg_a: string;
  seg_b: string;
  seg_c: string;
  seg_d: string;
  avg_monetary: string;
  last_computed: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const url = req.nextUrl;
    const segFilter = url.searchParams.get('segment');
    const sort = url.searchParams.get('sort') ?? 'monetary';
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') ?? '50', 10)));
    const offset = (page - 1) * perPage;

    const orderBy =
      sort === 'frequency'
        ? 'frequency DESC'
        : sort === 'recency'
          ? 'recency_days ASC'
          : 'monetary_halire DESC';

    const args: unknown[] = [promoter.promoterId];
    let segClause = '';
    if (segFilter && ['A', 'B', 'C', 'D'].includes(segFilter)) {
      args.push(segFilter);
      segClause = `AND segment = $${args.length}`;
    }

    const rows = await db().query<RfmRow>(
      `SELECT id, user_id, email, name, recency_days, frequency, monetary_halire::text,
              r_score, f_score, m_score, rfm_total, segment, computed_at::text
         FROM marketing.rfm_scores
        WHERE promoter_id = $1 ${segClause}
        ORDER BY ${orderBy}
        LIMIT ${perPage} OFFSET ${offset}`,
      args,
    );

    const agg = await db().query<AggRow>(
      `SELECT
         COUNT(*) FILTER (WHERE segment = 'A')::text AS seg_a,
         COUNT(*) FILTER (WHERE segment = 'B')::text AS seg_b,
         COUNT(*) FILTER (WHERE segment = 'C')::text AS seg_c,
         COUNT(*) FILTER (WHERE segment = 'D')::text AS seg_d,
         COALESCE(AVG(monetary_halire), 0)::text AS avg_monetary,
         MAX(computed_at)::text AS last_computed
         FROM marketing.rfm_scores
        WHERE promoter_id = $1`,
      [promoter.promoterId],
    );

    const a = agg.rows[0];
    const totals = {
      A: Number(a?.seg_a ?? 0),
      B: Number(a?.seg_b ?? 0),
      C: Number(a?.seg_c ?? 0),
      D: Number(a?.seg_d ?? 0),
    };

    return NextResponse.json({
      scores: rows.rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        email: r.email,
        name: r.name,
        recencyDays: r.recency_days,
        frequency: r.frequency,
        monetaryHalire: Number(r.monetary_halire),
        rScore: r.r_score,
        fScore: r.f_score,
        mScore: r.m_score,
        rfmTotal: r.rfm_total,
        segment: r.segment,
        computedAt: r.computed_at,
      })),
      totals,
      avgMonetary: Number(a?.avg_monetary ?? 0),
      lastComputed: a?.last_computed ?? null,
      page,
      perPage,
    });
  });
}
