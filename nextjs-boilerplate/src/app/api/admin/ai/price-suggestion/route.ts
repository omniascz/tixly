/**
 * POST /api/admin/ai/price-suggestion
 * Body: { category, venueId?, estimatedCapacity }
 *
 * Vrátí doporučenou cenu + reasoning + examples z minulých akcí.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { suggestPrice } from '@/lib/ai/price-suggest';

const schema = z.object({
  category: z.string().min(1).max(40),
  venueId: z.string().uuid().nullable().optional(),
  estimatedCapacity: z.number().int().min(1).max(1_000_000),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const suggestion = await suggestPrice({
    category: parsed.data.category,
    venueId: parsed.data.venueId ?? null,
    estimatedCapacity: parsed.data.estimatedCapacity,
    promoterId: promoter.promoterId,
  });
  return NextResponse.json({ suggestion });
}
