/**
 * POST /api/admin/ai/moderate
 *
 * On-demand moderation check pre publish — promotér si může otestovat content
 * před odesláním do real moderation queue.
 *
 * Body: { title, description?, ticketTypeNames? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { moderate } from '@/lib/ai/moderation';

const schema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  ticketTypeNames: z.array(z.string().max(100)).max(20).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const result = await moderate(parsed.data);
  return NextResponse.json(result);
}
