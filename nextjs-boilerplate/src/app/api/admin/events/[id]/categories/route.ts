/**
 * Slevové kategorie termínu (kolo 8 / krok 4).
 *   GET  — ceník: kategorie × zóny (typy vstupenek) → cena
 *   POST — přidat / upravit kategorii { code, name, kind, priceMode, priceValue, requiresProof?, proofLabel?, limitPerEvent? }
 *          nebo { applyTemplate: true } = výchozí šablona pořadatele jedním krokem
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { applyTemplate, priceTable, upsertCategory } from '@/lib/theatre/categories';
import { categorySchema } from '@/lib/theatre/category-schema';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

async function owned(promoterId: string, eventId: string): Promise<boolean> {
  return (await db().query(`SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`, [eventId, promoterId])).rows.length > 0;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    if (!(await owned(promoter.promoterId, params.id))) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json(await priceTable(db(), params.id));
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    if (!(await owned(promoter.promoterId, params.id))) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.applyTemplate === true) {
      const n = await applyTemplate(db(), promoter.promoterId, params.id);
      return NextResponse.json({ applied: n, ...(await priceTable(db(), params.id)) }, { status: 201 });
    }
    const parsed = categorySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const id = await upsertCategory(db(), promoter.promoterId, params.id, parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  });
}
