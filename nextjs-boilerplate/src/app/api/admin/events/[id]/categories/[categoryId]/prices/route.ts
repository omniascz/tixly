/**
 * PUT /api/admin/events/[id]/categories/[categoryId]/prices { ticketTypeId, priceMode, priceValue } — cena kategorie
 * v konkrétní zóně (pevná částka v haléřích nebo procento z plné ceny × 100). Kolo 8 / krok 4.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { setZonePrice } from '@/lib/theatre/categories';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;
const schema = z.object({
  ticketTypeId: z.string().uuid(),
  priceMode: z.enum(['percent', 'fixed']),
  priceValue: z.number().int().min(0),
}).refine((c) => c.priceMode !== 'percent' || c.priceValue <= 10000, { message: 'procento nejvýš 100 %' });

export async function PUT(req: NextRequest, { params }: { params: { id: string; categoryId: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id) || !UUID.test(params.categoryId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const ok = await db().query(
      `SELECT 1 FROM catalog.price_categories c JOIN catalog.ticket_types tt ON tt.event_id = c.event_id
        WHERE c.id = $1 AND c.event_id = $2 AND c.promoter_id = $3 AND tt.id = $4`,
      [params.categoryId, params.id, promoter.promoterId, parsed.data.ticketTypeId],
    );
    if (ok.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    await setZonePrice(db(), promoter.promoterId, params.categoryId, parsed.data.ticketTypeId, parsed.data.priceMode, parsed.data.priceValue);
    return NextResponse.json({ ok: true });
  });
}
