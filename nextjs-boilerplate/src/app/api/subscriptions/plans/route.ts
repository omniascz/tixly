/**
 * GET /api/subscriptions/plans — public list of active plans (Tixly+ landing).
 * Optional query: ?promoter=<slug> filter by promoter.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { launchFeatureNotFound } from '@/lib/features/launch-flags';


export async function GET(req: NextRequest): Promise<Response> {
  // Kolo 10: vypnuto přepínačem (výchozí stav) → 404.
  const featureOff = launchFeatureNotFound('subscriptions');
  if (featureOff) return featureOff;
  const slug = req.nextUrl.searchParams.get('promoter');
  const params: unknown[] = [];
  let where = `p.active = true`;
  if (slug) {
    params.push(slug);
    where += ` AND pr.slug = $${params.length}`;
  }

  const r = await db().query<{
    id: string;
    name: string;
    description: string | null;
    price_halire: number;
    billing_cycle: string;
    allowance_per_period: number;
    promoter_name: string | null;
  }>(
    `SELECT p.id, p.name, p.description, p.price_halire, p.billing_cycle,
            p.allowance_per_period, pr.name AS promoter_name
     FROM subscriptions.plans p
     LEFT JOIN platform.promoters pr ON pr.id = p.promoter_id
     WHERE ${where}
     ORDER BY p.price_halire ASC
     LIMIT 50`,
    params,
  );
  return NextResponse.json({ plans: r.rows });
}
