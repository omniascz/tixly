/**
 * POST /api/admin/ai/cover-image
 * Body: { title, category?, vibe?, primaryColor? }
 *
 * Vrátí 4 cover image varianty. Stub v demo, DALL-E v produkci (OPENAI_API_KEY).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { generateCoverImage } from '@/lib/ai/cover-image';

const schema = z.object({
  title: z.string().min(2).max(200),
  category: z.string().min(1).max(40).default('event'),
  vibe: z.enum(['energetic', 'elegant', 'underground', 'family', 'classical']).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const variants = await generateCoverImage(parsed.data);
  return NextResponse.json({
    variants,
    mode: process.env.AI_IMAGE_MODE === 'stub' || !process.env.OPENAI_API_KEY ? 'stub' : 'dalle3',
  });
}
