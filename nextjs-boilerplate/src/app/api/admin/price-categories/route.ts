/**
 * Výchozí šablona slevových kategorií pořadatele (kolo 8 / krok 4) — kategorie s event_id NULL.
 *   GET  — šablona (prázdná = použije se vestavěná DEFAULT_CATEGORY_TEMPLATE)
 *   POST — přidat / upravit kategorii šablony
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { DEFAULT_CATEGORY_TEMPLATE, listCategories, upsertCategory } from '@/lib/theatre/categories';
import { categorySchema } from '@/lib/theatre/category-schema';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const own = await listCategories(db(), promoter.promoterId, null);
    return NextResponse.json({ categories: own, builtInDefault: own.length === 0 ? DEFAULT_CATEGORY_TEMPLATE : null });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const parsed = categorySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const id = await upsertCategory(db(), promoter.promoterId, null, parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  });
}
