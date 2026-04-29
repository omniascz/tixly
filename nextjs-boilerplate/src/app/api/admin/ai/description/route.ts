/**
 * POST /api/admin/ai/description
 * Body: { title, category, venue?, dateStart?, language, extraContext? }
 *
 * Vrátí 3 varianty (energetic / elegant / informative).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { generateDescriptions } from '@/lib/ai/description-gen';

const schema = z.object({
  title: z.string().min(2).max(200),
  category: z.string().min(1).max(40),
  venue: z.string().max(200).optional(),
  dateStart: z.string().datetime().optional(),
  language: z.enum(['cs', 'en', 'de', 'fr', 'nl', 'es', 'pl', 'sk']).default('cs'),
  extraContext: z.string().max(500).optional(),
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

  const variants = await generateDescriptions(parsed.data);
  return NextResponse.json({ variants });
}
