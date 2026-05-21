/**
 * GET/POST /api/admin/ab-price-tests
 *
 * A/B price testing. Promotér nastaví variant A (current price) + variant B (test price)
 * + traffic split. Engine pak per-session assigne uživatele do variantu.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const postSchema = z.object({
  ticketTypeId: z.string().uuid(),
  name: z.string().min(2).max(200),
  variantAPrice: z.number().int().min(0).max(100_000_000),
  variantBPrice: z.number().int().min(0).max(100_000_000),
  variantBPct: z.number().int().min(1).max(99).default(50),
  endsAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const r = await db().query<{
    id: string;
    ticket_type_id: string;
    ticket_type_name: string;
    event_title: string;
    name: string;
    variant_a_price: number;
    variant_b_price: number;
    variant_b_pct: number;
    status: string;
    variant_a_visitors: number;
    variant_b_visitors: number;
    variant_a_conversions: number;
    variant_b_conversions: number;
    winner_variant: string | null;
    starts_at: string;
    ends_at: string | null;
  }>(
    `SELECT abt.id, abt.ticket_type_id, tt.name AS ticket_type_name, e.title AS event_title,
            abt.name, abt.variant_a_price, abt.variant_b_price, abt.variant_b_pct,
            abt.status,
            abt.variant_a_visitors, abt.variant_b_visitors,
            abt.variant_a_conversions, abt.variant_b_conversions,
            abt.winner_variant, abt.starts_at::text, abt.ends_at::text
       FROM catalog.ab_price_tests abt
       JOIN catalog.ticket_types tt ON tt.id = abt.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
      WHERE e.promoter_id = $1
   ORDER BY abt.created_at DESC
      LIMIT 100`,
    [promoter.promoterId],
  );

  // Compute conversion rates + significance hint
  const tests = r.rows.map((t) => {
    const convA = t.variant_a_visitors > 0 ? t.variant_a_conversions / t.variant_a_visitors : 0;
    const convB = t.variant_b_visitors > 0 ? t.variant_b_conversions / t.variant_b_visitors : 0;
    const lift = convA > 0 ? ((convB - convA) / convA) * 100 : 0;
    const totalVisitors = t.variant_a_visitors + t.variant_b_visitors;
    return {
      ...t,
      conversionA: Number((convA * 100).toFixed(2)),
      conversionB: Number((convB * 100).toFixed(2)),
      lift: Number(lift.toFixed(1)),
      hasSignificance: totalVisitors >= 200 && (t.variant_a_conversions + t.variant_b_conversions) >= 20,
    };
  });

  return NextResponse.json({ tests });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }

  // Ownership
  const own = await db().query(
    `SELECT 1 FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
      WHERE tt.id = $1 AND e.promoter_id = $2`,
    [parsed.data.ticketTypeId, promoter.promoterId],
  );
  if (own.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.ab_price_tests
       (ticket_type_id, name, variant_a_price, variant_b_price, variant_b_pct, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     RETURNING id`,
    [
      parsed.data.ticketTypeId, parsed.data.name,
      parsed.data.variantAPrice, parsed.data.variantBPrice,
      parsed.data.variantBPct, parsed.data.endsAt ?? null,
    ],
  );

  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
