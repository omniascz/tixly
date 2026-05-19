/**
 * POST /api/admin/ai/social-posts
 * Body: { title, category, venue?, dateStart?, url?, language? }
 *
 * Vrátí 3 posts: facebook, instagram, twitter.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { generateSocialPosts } from '@/lib/ai/social-post';

const schema = z.object({
  title: z.string().min(2).max(200),
  category: z.string().min(1).max(40),
  venue: z.string().max(200).optional(),
  dateStart: z.string().datetime().optional(),
  url: z.string().url().max(500).optional(),
  language: z.enum(['cs', 'en']).default('cs'),
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
  const posts = await generateSocialPosts(parsed.data);
  return NextResponse.json({ posts });
}
