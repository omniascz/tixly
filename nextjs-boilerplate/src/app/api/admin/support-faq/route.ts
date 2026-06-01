/**
 * GET  /api/admin/support-faq — list (platform global + own promoter)
 * POST /api/admin/support-faq — create
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const schema = z.object({
  question: z.string().min(5).max(300),
  answer: z.string().min(5).max(2000),
  category: z.string().max(40).nullable().optional(),
  language: z.enum(['cs', 'en']).default('cs'),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
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

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
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
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
