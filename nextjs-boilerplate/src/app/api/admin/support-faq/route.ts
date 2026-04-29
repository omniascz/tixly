/**
 * GET  /api/admin/support-faq — list (platform global + own promoter)
 * POST /api/admin/support-faq — create
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  question: z.string().min(5).max(300),
  answer: z.string().min(5).max(2000),
  category: z.string().max(40).nullable().optional(),
  language: z.enum(['cs', 'en']).default('cs'),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    id: string;
    promoter_id: string | null;
    question: string;
    answer: string;
    category: string | null;
    active: boolean;
    language: string;
    created_at: string;
  }>(
    `SELECT id, promoter_id, question, answer, category, active, language, created_at
     FROM marketing.support_faq
     WHERE active = true AND (promoter_id IS NULL OR promoter_id = $1)
     ORDER BY promoter_id NULLS FIRST, category, created_at DESC`,
    [promoter.promoterId],
  );
  return NextResponse.json({ entries: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const r = await db().query<{ id: string }>(
    `INSERT INTO marketing.support_faq (promoter_id, question, answer, category, language)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      promoter.promoterId,
      parsed.data.question,
      parsed.data.answer,
      parsed.data.category ?? null,
      parsed.data.language,
    ],
  );
  return NextResponse.json({ id: r.rows[0]!.id }, { status: 201 });
}
