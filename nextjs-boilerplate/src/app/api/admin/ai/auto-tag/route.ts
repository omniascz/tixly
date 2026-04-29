/**
 * POST /api/admin/ai/auto-tag
 * Body: { title, description?, category?, eventId? (optional, persist tags) }
 *
 * Vrátí extracted tags. Pokud eventId, persist do catalog.events.ai_tags.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';
import { autoTag } from '@/lib/ai/auto-tag';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(5000).nullable().optional(),
  category: z.string().max(40).optional(),
  eventId: z.string().uuid().optional(),
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

  const result = await autoTag({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    category: parsed.data.category,
  });

  if (parsed.data.eventId) {
    // Ownership check + save
    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [parsed.data.eventId, promoter.promoterId],
    );
    if (owns.rows.length > 0) {
      await db().query(
        `UPDATE catalog.events
         SET ai_tags = $2::text[], ai_tags_generated_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [parsed.data.eventId, result.tags],
      );
    }
  }

  return NextResponse.json(result);
}
